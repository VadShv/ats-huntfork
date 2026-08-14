/**
 * commsService — ядро модуля коммуникаций (Спринт 17, MVP: hh.ru чат).
 *
 * Отвечает за: резолв/создание диалога по отклику, ингест сообщений
 * с идемпотентностью, отправку, отметку прочитанного и денормализованные
 * счётчики на comms_conversation. Канальные адаптеры (hhChat.ts) — только транспорт.
 */
import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm'
import {
  application,
  commsConversation,
  commsMessage,
  commsTelegramBusinessConnection,
  hhNegotiation,
  hhVacancyLink,
} from '../../database/schema'
import { getValidAccessToken } from '../hh/tokens'
import { apiGet } from '../hh/client'
import { hhGetChatMessages, hhMarkMessageRead, hhSendChatMessage, type HhChatMessage } from './hhChat'
import { getBotToken, getTelegramBotForOrg, parseBizExternalChatId, tgSendMessage, TelegramApiError } from './telegram'
import { getJobAssistantSettings } from './assistant'

export type CommsConversationRow = typeof commsConversation.$inferSelect
export type CommsMessageRow = typeof commsMessage.$inferSelect

const PREVIEW_LEN = 140

export function preview(text: string | null | undefined): string | null {
  if (!text) return null
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > PREVIEW_LEN ? `${s.slice(0, PREVIEW_LEN - 1)}…` : s
}

/**
 * Находит или создаёт hh-диалог для отклика.
 * Возвращает null, если у отклика нет hh-связки или у чата нет chat_id.
 */
export async function ensureHhConversation(
  applicationId: string,
  organizationId: string,
): Promise<{ conversation: CommsConversationRow | null, reason?: string }> {
  // 1. Отклик должен существовать в организации
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, organizationId)),
    columns: { id: true, candidateId: true, jobId: true },
  })
  if (!app) return { conversation: null, reason: 'application_not_found' }

  // 2. Уже есть диалог, привязанный к этому отклику?
  const existing = await db.query.commsConversation.findFirst({
    where: and(
      eq(commsConversation.organizationId, organizationId),
      eq(commsConversation.channel, 'hh'),
      eq(commsConversation.applicationId, applicationId),
    ),
  })
  if (existing) return { conversation: existing }

  // 3. Ищем hh-отклик (negotiation) этого application
  const neg = await db.query.hhNegotiation.findFirst({
    where: and(
      eq(hhNegotiation.organizationId, organizationId),
      eq(hhNegotiation.applicationId, applicationId),
    ),
  })
  if (!neg) return { conversation: null, reason: 'no_hh_negotiation' }

  const link = await db.query.hhVacancyLink.findFirst({
    where: eq(hhVacancyLink.id, neg.hhVacancyLinkId),
    columns: { id: true, hhAccountId: true },
  })
  if (!link) return { conversation: null, reason: 'no_hh_link' }

  // 4. chat_id: из raw-снепшота отклика, с фолбэком на GET /negotiations/{id}
  let chatId = (neg.rawNegotiationJson as { chat_id?: string | null } | null)?.chat_id ?? null
  if (!chatId) {
    try {
      const token = await getValidAccessToken(link.hhAccountId)
      const detail = await apiGet<{ chat_id?: string | null }>(
        `/negotiations/${encodeURIComponent(neg.hhNegotiationId)}`,
        token,
      )
      chatId = detail.chat_id ?? null
      if (chatId) {
        const merged = { ...(neg.rawNegotiationJson as Record<string, unknown> | null ?? {}), chat_id: chatId }
        await db.update(hhNegotiation)
          .set({ rawNegotiationJson: merged, updatedAt: new Date() })
          .where(eq(hhNegotiation.id, neg.id))
      }
    }
    catch (err) {
      logWarn('comms.ensure_chat_id_failed', {
        negotiation_id: neg.id,
        error_message: err instanceof Error ? err.message : String(err),
      })
      return { conversation: null, reason: 'hh_api_error' }
    }
  }
  if (!chatId) return { conversation: null, reason: 'no_chat_id' }

  // Чат 2.0: режим ассистента для НОВОГО диалога — из настроек ИИ-чата вакансии
  // (только при insert; у существующих диалогов режим не трогаем)
  let defaultAssistantMode = 'off'
  if (app.jobId) {
    try {
      const jobSettings = await getJobAssistantSettings(app.jobId)
      if (jobSettings?.enabled && jobSettings.defaultAssistantMode) {
        defaultAssistantMode = jobSettings.defaultAssistantMode
      }
    }
    catch { /* некритично — оставим off */ }
  }

  // 5. Upsert по (org, channel, external_chat_id) — гонки схлопываются на уникальном индексе
  const inserted = await db.insert(commsConversation)
    .values({
      organizationId,
      channel: 'hh',
      externalChatId: chatId,
      candidateId: app.candidateId,
      applicationId: app.id,
      jobId: app.jobId,
      hhNegotiationId: neg.id,
      hhAccountId: link.hhAccountId,
      assistantMode: defaultAssistantMode,
    })
    .onConflictDoUpdate({
      target: [commsConversation.organizationId, commsConversation.channel, commsConversation.externalChatId],
      set: {
        candidateId: app.candidateId,
        applicationId: app.id,
        jobId: app.jobId,
        hhNegotiationId: neg.id,
        hhAccountId: link.hhAccountId,
        updatedAt: new Date(),
      },
    })
    .returning()

  return { conversation: inserted[0] ?? null }
}

/** Направление и тип отправителя по данным hh. */
function classifySender(msg: HhChatMessage): { direction: 'in' | 'out', senderType: string } {
  const role = msg.sender_display_info?.role
  if (role === 'APPLICANT') return { direction: 'in', senderType: 'candidate' }
  if (role === 'BOT') return { direction: 'out', senderType: 'system' }
  return { direction: 'out', senderType: 'recruiter' }
}

/**
 * Подтягивает последние сообщения из hh и идемпотентно сохраняет новые.
 * Обновляет кэш can_write / unread / last_message на диалоге.
 */
export async function refreshHhConversation(conv: CommsConversationRow): Promise<void> {
  if (!conv.hhAccountId) throw new Error('conversation has no hh account')
  const token = await getValidAccessToken(conv.hhAccountId)
  const resp = await hhGetChatMessages(token, conv.externalChatId, 50)

  // Оставляем только контентные сообщения (text/attachments)
  const contentMsgs = resp.messages.filter(m => m.payload?.text || (m.payload?.attachments?.length ?? 0) > 0)

  if (contentMsgs.length > 0) {
    const extIds = contentMsgs.map(m => m.id)
    const known = await db.select({ externalMessageId: commsMessage.externalMessageId })
      .from(commsMessage)
      .where(and(
        eq(commsMessage.conversationId, conv.id),
        inArray(commsMessage.externalMessageId, extIds),
      ))
    const knownSet = new Set(known.map(r => r.externalMessageId))
    const fresh = contentMsgs.filter(m => !knownSet.has(m.id))

    if (fresh.length > 0) {
      await db.insert(commsMessage)
        .values(fresh.map((m) => {
          const { direction, senderType } = classifySender(m)
          return {
            organizationId: conv.organizationId,
            conversationId: conv.id,
            externalMessageId: m.id,
            direction,
            senderType,
            senderName: m.sender_display_info?.name ?? null,
            body: m.payload?.text ?? null,
            attachments: m.payload?.attachments ?? null,
            status: (direction === 'in' ? 'received' : 'sent') as 'received' | 'sent',
            externalCreatedAt: m.creation_time ? new Date(m.creation_time) : null,
          }
        }))
        .onConflictDoNothing()
    }
  }

  // Денормализация на диалоге
  const newest = contentMsgs[0] // order=prev → первый = самый новый
  await db.update(commsConversation)
    .set({
      canWrite: resp.chat_states?.write_message_state?.allowed ?? true,
      canWriteReason: resp.chat_states?.write_message_state?.reason ?? null,
      unreadCount: resp.unread_message_count ?? 0,
      ...(newest
        ? {
            lastMessageAt: newest.creation_time ? new Date(newest.creation_time) : new Date(),
            lastMessagePreview: preview(newest.payload?.text) ?? (newest.payload?.attachments?.length ? '📎' : null),
            lastMessageDirection: classifySender(newest).direction,
          }
        : {}),
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(commsConversation.id, conv.id))
}

/** Сообщения диалога в хронологическом порядке. */
export function listConversationMessages(conversationId: string, limit = 200): Promise<CommsMessageRow[]> {
  return db.select()
    .from(commsMessage)
    .where(and(
      eq(commsMessage.conversationId, conversationId),
      // Чат 2.0: generating-черновики тоже не показываем в ленте — они едут отдельным полем draft
      notInArray(commsMessage.status, ['suggested', 'discarded', 'generating']),
    ))
    .orderBy(asc(commsMessage.externalCreatedAt), asc(commsMessage.createdAt))
    .limit(limit)
}

/**
 * Отправка сообщения в диалог — канал-независимо (Спринт 19).
 * Синхронно: транспорт канала (hh / telegram) → запись в БД.
 * При ошибке пишем failed-строку и пробрасываем исключение наверх.
 */
export async function sendConversationMessage(
  conv: CommsConversationRow,
  // Чат 2.0: senderType/senderName опциональны — автопилот шлёт от имени агента (userId может быть null)
  args: { userId: string | null, userName: string | null, text: string, senderType?: 'recruiter' | 'agent' | 'system', senderName?: string | null },
): Promise<CommsMessageRow> {
  const senderType = args.senderType ?? 'recruiter'
  const senderName = args.senderName ?? args.userName
  if (!conv.canWrite) {
    throw createError({ statusCode: 400, statusMessage: 'Чат недоступен для отправки сообщений' })
  }

  let externalId: string | null = null
  try {
    if (conv.channel === 'hh') {
      if (!conv.hhAccountId) {
        throw createError({ statusCode: 400, statusMessage: 'У диалога нет аккаунта hh.ru' })
      }
      const token = await getValidAccessToken(conv.hhAccountId)
      externalId = await hhSendChatMessage(token, conv.externalChatId, args.text)
    }
    else if (conv.channel === 'telegram') {
      const bot = await getTelegramBotForOrg(conv.organizationId)
      if (!bot || !bot.enabled) {
        throw createError({ statusCode: 400, statusMessage: 'Telegram-бот не подключён или выключен' })
      }
      if (conv.tgBusinessConnectionId) {
        // Спринт 19.5: ответ ОТ ИМЕНИ личного аккаунта рекрутёра (Telegram Business)
        const bizConn = await db.query.commsTelegramBusinessConnection.findFirst({
          where: eq(commsTelegramBusinessConnection.id, conv.tgBusinessConnectionId),
        })
        if (!bizConn || !bizConn.enabled) {
          throw createError({ statusCode: 400, statusMessage: 'Личный Telegram отключён от бота. Подключите бота заново: Настройки → Telegram Business → Чат-боты' })
        }
        if (!bizConn.canReply) {
          throw createError({ statusCode: 400, statusMessage: 'У бота нет права отвечать от вашего имени. Включите «Отвечать на сообщения» в настройках чат-бота Telegram Business' })
        }
        const parsed = parseBizExternalChatId(conv.externalChatId)
        if (!parsed) {
          throw createError({ statusCode: 400, statusMessage: 'Некорректный идентификатор чата личного Telegram' })
        }
        try {
          externalId = await tgSendMessage(getBotToken(bot), parsed.chatId, args.text, { businessConnectionId: bizConn.connectionId })
        }
        catch (err) {
          // Окно 24ч без входящих закрыто — Telegram запрещает писать первым через business
          if (err instanceof TelegramApiError && /BUSINESS_PEER_USAGE_MISSING|BUSINESS_CONNECTION/i.test(err.message)) {
            throw createError({ statusCode: 400, statusMessage: 'Окно ответа 24ч закрыто: кандидат давно не писал. Напишите ему лично из своего Telegram' })
          }
          throw err
        }
      }
      else {
        externalId = await tgSendMessage(getBotToken(bot), conv.externalChatId, args.text)
      }
    }
    else {
      throw createError({ statusCode: 400, statusMessage: `Канал ${conv.channel} пока не поддерживает отправку` })
    }
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.insert(commsMessage).values({
      organizationId: conv.organizationId,
      conversationId: conv.id,
      direction: 'out',
      senderType,
      senderUserId: args.userId,
      senderName,
      body: args.text,
      status: 'failed',
      errorMessage: msg.slice(0, 500),
    })
    logError('comms.send_failed', { conversation_id: conv.id, channel: conv.channel, error_message: msg })
    // Дружелюбные 400-ки (окно 24ч, отключённое business-подключение и пр.) отдаём как есть
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode?: number }).statusCode === 400) {
      throw err
    }
    throw createError({ statusCode: 502, statusMessage: conv.channel === 'telegram' ? 'Не удалось отправить сообщение в Telegram' : 'Не удалось отправить сообщение в hh.ru' })
  }

  const inserted = await db.insert(commsMessage)
    .values({
      organizationId: conv.organizationId,
      conversationId: conv.id,
      externalMessageId: externalId,
      direction: 'out',
      senderType,
      senderUserId: args.userId,
      senderName,
      body: args.text,
      status: 'sent',
      externalCreatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning()

  await db.update(commsConversation)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: preview(args.text),
      lastMessageDirection: 'out',
      updatedAt: new Date(),
    })
    .where(eq(commsConversation.id, conv.id))

  // Гонка с onConflictDoNothing (сообщение уже проросло через refresh) — вернём существующее
  if (inserted[0]) return inserted[0]
  const existing = await db.query.commsMessage.findFirst({
    where: and(
      eq(commsMessage.conversationId, conv.id),
      eq(commsMessage.externalMessageId, externalId ?? ''),
    ),
  })
  return existing!
}

/**
 * Отметить диалог прочитанным. Для hh — ещё и на стороне hh.ru;
 * у Telegram Bot API понятия «прочитано» нет — только локальный счётчик.
 */
export async function markConversationRead(conv: CommsConversationRow): Promise<void> {
  if (conv.channel === 'hh' && conv.hhAccountId) {
    const [lastIncoming] = await db.select({ externalMessageId: commsMessage.externalMessageId })
      .from(commsMessage)
      .where(and(
        eq(commsMessage.conversationId, conv.id),
        eq(commsMessage.direction, 'in'),
      ))
      .orderBy(desc(commsMessage.externalCreatedAt))
      .limit(1)
    if (lastIncoming?.externalMessageId) {
      try {
        const token = await getValidAccessToken(conv.hhAccountId)
        await hhMarkMessageRead(token, conv.externalChatId, lastIncoming.externalMessageId)
      }
      catch (err) {
        // Не критично: локальный счётчик всё равно сбрасываем
        logWarn('comms.mark_read_failed', {
          conversation_id: conv.id,
          error_message: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  await db.update(commsConversation)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(eq(commsConversation.id, conv.id))
}
