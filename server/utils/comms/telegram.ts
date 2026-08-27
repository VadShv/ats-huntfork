/**
 * Спринт 19 — клиент Telegram Bot API и доступ к боту организации.
 *
 * Здесь только транспорт: вызовы Bot API, работа с токеном (шифрование),
 * приветствия и пригласительные deep-link'и. Логика диалогов/сообщений —
 * в commsService.ts (канал-независимая) и telegramWebhooks.ts (ингест).
 */
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { commsTelegramBot } from '../../database/schema'
import { decrypt, encrypt } from '../encryption'
import { env } from '../env'

const TG_API_BASE = 'https://api.telegram.org'
/** Максимальная длина одного сообщения Telegram. */
const TG_MESSAGE_LIMIT = 4096

export type CommsTelegramBotRow = typeof commsTelegramBot.$inferSelect

// ── Низкоуровневый вызов Bot API ─────────────────────────────────────────

interface TgApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

export class TelegramApiError extends Error {
  constructor(public method: string, public code: number | null, description: string) {
    super(`telegram ${method} failed${code ? ` (${code})` : ''}: ${description}`)
  }
}

async function tgCall<T>(token: string, method: string, payload?: Record<string, unknown>): Promise<T> {
  const res = await $fetch<TgApiResponse<T>>(`${TG_API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    body: payload ?? {},
    timeout: 15_000,
    // Telegram отвечает JSON и на ошибки — разбираем сами
    ignoreResponseError: true,
  })
  if (!res || res.ok !== true || res.result === undefined) {
    throw new TelegramApiError(method, res?.error_code ?? null, res?.description ?? 'unknown error')
  }
  return res.result
}

// ── Методы Bot API ───────────────────────────────────────────────────────

export interface TgUser {
  id: number
  is_bot: boolean
  first_name: string
  last_name?: string
  username?: string
}

export function tgGetMe(token: string): Promise<TgUser> {
  return tgCall<TgUser>(token, 'getMe')
}

export function tgSetWebhook(token: string, url: string, secretToken: string): Promise<boolean> {
  return tgCall<boolean>(token, 'setWebhook', {
    url,
    secret_token: secretToken,
    // Спринт 19.5: + события Telegram Business (личный аккаунт рекрутера)
    allowed_updates: ['message', 'business_connection', 'business_message'],
    drop_pending_updates: false,
  })
}

export function tgDeleteWebhook(token: string): Promise<boolean> {
  return tgCall<boolean>(token, 'deleteWebhook', { drop_pending_updates: false })
}

export interface TgMessage {
  message_id: number
  chat: { id: number, type: string, first_name?: string, last_name?: string, username?: string }
  from?: TgUser
  /** Спринт 19.5: есть у сообщений из чатов личного аккаунта (Telegram Business). */
  business_connection_id?: string
  date: number
  text?: string
  caption?: string
  photo?: Array<{ file_id: string, file_size?: number, width: number, height: number }>
  document?: { file_id: string, file_name?: string, mime_type?: string, file_size?: number }
  voice?: { file_id: string, duration: number, mime_type?: string, file_size?: number }
  video?: { file_id: string, file_name?: string, mime_type?: string, file_size?: number }
}

/** Подключение бота к личному аккаунту (Telegram Business, Bot API 7.2+). */
export interface TgBusinessConnection {
  id: string
  user: TgUser
  user_chat_id: number
  date: number
  is_enabled: boolean
  /** can_reply до Bot API 9.0, далее — rights.can_reply. */
  can_reply?: boolean
  rights?: { can_reply?: boolean }
}

/** Отправка текста с разбиением на части по лимиту Telegram (4096).
 * С businessConnectionId сообщение уходит ОТ ИМЕНИ личного аккаунта рекрутера. */
export async function tgSendMessage(token: string, chatId: string, text: string, opts: { businessConnectionId?: string } = {}): Promise<string> {
  const chunks: string[] = []
  let rest = text
  while (rest.length > TG_MESSAGE_LIMIT) {
    // Режем по последнему переносу/пробелу в пределах лимита, иначе жёстко
    let cut = rest.lastIndexOf('\n', TG_MESSAGE_LIMIT)
    if (cut < TG_MESSAGE_LIMIT * 0.5) cut = rest.lastIndexOf(' ', TG_MESSAGE_LIMIT)
    if (cut < TG_MESSAGE_LIMIT * 0.5) cut = TG_MESSAGE_LIMIT
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).trimStart()
  }
  chunks.push(rest)

  let lastId = ''
  for (const chunk of chunks) {
    const msg = await tgCall<TgMessage>(token, 'sendMessage', {
      chat_id: chatId,
      text: chunk,
      ...(opts.businessConnectionId ? { business_connection_id: opts.businessConnectionId } : {}),
    })
    lastId = String(msg.message_id)
  }
  return lastId
}

interface TgFile {
  file_id: string
  file_size?: number
  file_path?: string
}

/** Скачивание файла из Telegram (getFile → file API). До 20 МБ по лимиту Bot API. */
export async function tgDownloadFile(token: string, fileId: string): Promise<{ buffer: Buffer, filePath: string } | null> {
  const file = await tgCall<TgFile>(token, 'getFile', { file_id: fileId })
  if (!file.file_path) return null
  const raw = await $fetch.raw(`${TG_API_BASE}/file/bot${token}/${file.file_path}`, {
    responseType: 'arrayBuffer',
    timeout: 30_000,
  })
  const body = raw._data as ArrayBuffer | undefined
  if (!body) return null
  return { buffer: Buffer.from(body), filePath: file.file_path }
}

// ── Бот организации ──────────────────────────────────────────────────────

export function getTelegramBotForOrg(organizationId: string): Promise<CommsTelegramBotRow | undefined> {
  return db.query.commsTelegramBot.findFirst({
    where: eq(commsTelegramBot.organizationId, organizationId),
  })
}

/** Расшифрованный токен бота. Бросает понятную ошибку, если расшифровка не удалась. */
export function getBotToken(bot: CommsTelegramBotRow): string {
  const token = decrypt(bot.botTokenEncrypted, env.BETTER_AUTH_SECRET)
  if (!token) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось расшифровать токен Telegram-бота' })
  }
  return token
}

export function encryptBotToken(token: string): string {
  return encrypt(token, env.BETTER_AUTH_SECRET)
}

export function generateTelegramSecret(): string {
  // base64url — безопасен и для URL, и для заголовка secret_token (A-Za-z0-9_-)
  return randomBytes(24).toString('base64url')
}

/** Публичный URL вебхука бота (Telegram требует HTTPS). */
export function buildTelegramWebhookUrl(secret: string): string {
  const explicit = env.BETTER_AUTH_URL?.trim()
  const railway = env.RAILWAY_PUBLIC_DOMAIN?.trim()
  const base = explicit || (railway ? `https://${railway.replace(/^https?:\/\//, '')}` : '')
  if (!base) {
    throw createError({ statusCode: 500, statusMessage: 'Не настроен публичный URL приложения (BETTER_AUTH_URL)' })
  }
  return `${base.replace(/\/+$/, '')}/api/webhooks/telegram/${secret}`
}

/** Deep-link приглашения кандидата: t.me/<bot>?start=<token>. */
export function buildTelegramInviteLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${token}`
}

// ── Telegram Business: personal-чаты ─────────────────────────────────────

/**
 * external_chat_id для чатов личного аккаунта: `biz:<tg id владельца>:<chat id>`.
 * Префикс исключает коллизию с чатом бота (там chat id кандидата без префикса),
 * а стабильный tg id владельца переживает смену connection_id при перенастройке.
 */
export function buildBizExternalChatId(ownerTgId: string, chatId: string): string {
  return `biz:${ownerTgId}:${chatId}`
}

export function parseBizExternalChatId(ext: string): { ownerTgId: string, chatId: string } | null {
  if (!ext.startsWith('biz:')) return null
  const parts = ext.split(':')
  if (parts.length !== 3 || !parts[1] || !parts[2]) return null
  return { ownerTgId: parts[1], chatId: parts[2] }
}

/** Нормализация telegram-контакта кандидата к username без @/ссылки. */
export function normalizeTgUsername(raw: string | null | undefined): string | null {
  if (!raw) return null
  let v = raw.trim().toLowerCase()
  v = v.replace(/^https?:\/\/(www\.)?(t\.me|telegram\.me)\//, '')
  v = v.replace(/^@/, '')
  v = v.split(/[/?#\s]/)[0] ?? ''
  return /^[a-z0-9_]{4,32}$/.test(v) ? v : null
}
