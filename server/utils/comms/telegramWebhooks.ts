/**
 * Спринт 19 — обработка вебхуков Telegram.
 *
 * Поток (зеркало hh, Спринт 18.1):
 *   Telegram → POST /api/webhooks/telegram/{secret}  (быстрый ACK, журнал comms_channel_event)
 *            → pg-boss очередь TG_WEBHOOK_QUEUE → processTelegramWebhookJob()
 *
 * Привязка кандидата: deep-link t.me/<bot>?start=<токен> (comms_telegram_link_token).
 * Анти-спам: сообщения из чатов без привязанного диалога игнорируются.
 */
import { and, eq, sql } from 'drizzle-orm'
import {
  commsChannelEvent,
  commsConversation,
  commsMessage,
  commsTelegramLinkToken,
  candidate as candidateTable,
  job as jobTable,
} from '../../database/schema'
import { getBoss } from '../queue/boss'
import { sendConversationMessage, preview, type CommsConversationRow } from './commsService'
import { getJobAssistantSettings } from './assistant'
import { maybeTriggerAutopilot } from './assistantJobs'
import {
  getBotToken,
  getTelegramBotForOrg,
  tgDownloadFile,
  tgSendMessage,
  type CommsTelegramBotRow,
  type TgMessage,
} from './telegram'
import { uploadToS3 } from '../s3'

export const TG_WEBHOOK_QUEUE = 'comms-telegram-webhook'

export interface TgWebhookJobPayload { eventRowId: string }

/** Конверт update Telegram (подписаны только на message). */
export interface TgUpdateEnvelope {
  update_id?: number
  message?: TgMessage
  edited_message?: TgMessage
}

/** Поставить событие в очередь. Best-effort — журнал не потеряется. */
export async function enqueueTelegramWebhookEvent(eventRowId: string): Promise<boolean> {
  try {
    const boss = await getBoss()
    await boss.send(TG_WEBHOOK_QUEUE, { eventRowId } satisfies TgWebhookJobPayload, {
      retryLimit: 3,
      retryDelay: 20,
      retryBackoff: true,
      expireInSeconds: 5 * 60,
    })
    return true
  }
  catch (err) {
    logError('comms.tg_webhook_enqueue_failed', {
      event_row_id: eventRowId,
      error_message: err instanceof Error ? err.message : String(err),
      module: 'comms',
    })
    return false
  }
}

async function finishEvent(id: string, status: 'processed' | 'skipped' | 'failed', errorMessage?: string): Promise<void> {
  await db.update(commsChannelEvent)
    .set({ status, errorMessage: errorMessage ?? null, processedAt: new Date() })
    .where(eq(commsChannelEvent.id, id))
}

/** Воркер (pg-boss 10 передаёт массив джобов — принимаем оба варианта). */
export async function processTelegramWebhookJob(
  input: { data: TgWebhookJobPayload } | Array<{ data: TgWebhookJobPayload }>,
): Promise<void> {
  const jobs = Array.isArray(input) ? input : [input]
  for (const job of jobs) {
    await processOneUpdate(job.data)
  }
}

async function processOneUpdate(data: TgWebhookJobPayload): Promise<void> {
  const row = await db.query.commsChannelEvent.findFirst({
    where: eq(commsChannelEvent.id, data.eventRowId),
  })
  if (!row) return
  if (row.status === 'processed' || row.status === 'skipped') return

  const update = (row.payload ?? {}) as TgUpdateEnvelope
  const msg = update.message
  try {
    if (!msg || !msg.chat) {
      // edited_message и прочее пока сознательно пропускаем
      await finishEvent(row.id, 'skipped', update.edited_message ? 'edited_message' : 'no_message')
      return
    }
    if (msg.from?.is_bot) {
      await finishEvent(row.id, 'skipped', 'from_bot')
      return
    }
    const bot = await getTelegramBotForOrg(row.organizationId)
    if (!bot || !bot.enabled) {
      await finishEvent(row.id, 'skipped', 'bot_disabled')
      return
    }

    const text = (msg.text ?? msg.caption ?? '').trim()
    if (text.startsWith('/start')) {
      await handleStart(row.id, row.organizationId, bot, msg, text)
      return
    }
    await handleInbound(row.id, row.organizationId, bot, msg, text)
  }
  catch (err) {
    const msgText = err instanceof Error ? err.message : String(err)
    await finishEvent(row.id, 'failed', msgText.slice(0, 500))
    logError('comms.tg_webhook_job_failed', {
      event_row_id: row.id,
      error_message: msgText,
      module: 'comms',
    })
    throw err // pg-boss ретраит
  }
}

// ── /start <токен>: привязка кандидата ──────────────────────────────────

async function handleStart(
  eventRowId: string,
  organizationId: string,
  bot: CommsTelegramBotRow,
  msg: TgMessage,
  text: string,
): Promise<void> {
  const chatId = String(msg.chat.id)
  const tokenValue = text.split(/\s+/)[1] ?? ''
  const botToken = getBotToken(bot)

  const fail = async (reason: string, reply: string) => {
    try {
      await tgSendMessage(botToken, chatId, reply)
    }
    catch { /* канал может быть закрыт — не критично */ }
    await finishEvent(eventRowId, 'skipped', reason)
  }

  if (!tokenValue) {
    await fail('start_no_token', 'Здравствуйте! Этот бот работает по персональным приглашениям от рекрутёра. Пожалуйста, перейдите по ссылке из вашего приглашения.')
    return
  }

  const link = await db.query.commsTelegramLinkToken.findFirst({
    where: and(
      eq(commsTelegramLinkToken.organizationId, organizationId),
      eq(commsTelegramLinkToken.token, tokenValue),
    ),
  })
  if (!link) {
    await fail('start_bad_token', 'Ссылка-приглашение не найдена. Попросите рекрутёра прислать новую.')
    return
  }
  if (link.expiresAt.getTime() < Date.now()) {
    await fail('start_token_expired', 'Срок действия приглашения истёк. Попросите рекрутёра прислать новую ссылку.')
    return
  }

  // Режим ассистента для нового диалога — из настроек ИИ-чата вакансии
  let defaultAssistantMode = 'off'
  if (link.jobId) {
    try {
      const jobSettings = await getJobAssistantSettings(link.jobId)
      if (jobSettings?.enabled && jobSettings.defaultAssistantMode) {
        defaultAssistantMode = jobSettings.defaultAssistantMode
      }
    }
    catch { /* некритично */ }
  }

  // Upsert по (org, channel, external_chat_id): повторный /start перепривязывает
  // диалог к свежему отклику/вакансии, историю сообщений сохраняем.
  const inserted = await db.insert(commsConversation)
    .values({
      organizationId,
      channel: 'telegram',
      externalChatId: chatId,
      candidateId: link.candidateId,
      applicationId: link.applicationId,
      jobId: link.jobId,
      assistantMode: defaultAssistantMode,
      canWrite: true,
    })
    .onConflictDoUpdate({
      target: [commsConversation.organizationId, commsConversation.channel, commsConversation.externalChatId],
      set: {
        candidateId: link.candidateId,
        applicationId: link.applicationId,
        jobId: link.jobId,
        canWrite: true,
        updatedAt: new Date(),
      },
    })
    .returning()
  const conv = inserted[0]
  if (!conv) {
    await finishEvent(eventRowId, 'failed', 'conversation_upsert_failed')
    return
  }

  await db.update(commsTelegramLinkToken)
    .set({ usedAt: new Date(), usedByTgUserId: msg.from ? String(msg.from.id) : null })
    .where(eq(commsTelegramLinkToken.id, link.id))

  // Приветствие: кастомное из настроек бота или стандартное с подстановками
  const welcome = await buildWelcome(bot, link.candidateId, link.jobId)
  try {
    await sendConversationMessage(conv, {
      userId: null,
      userName: null,
      text: welcome,
      senderType: 'system',
      senderName: 'Бот',
    })
  }
  catch (err) {
    logWarn('comms.tg_welcome_failed', {
      conversation_id: conv.id,
      error_message: err instanceof Error ? err.message : String(err),
    })
  }

  await finishEvent(eventRowId, 'processed')
  logInfo('comms.tg_candidate_linked', {
    conversation_id: conv.id,
    candidate_id: link.candidateId,
    organization_id: organizationId,
    module: 'comms',
  })
}

async function buildWelcome(bot: CommsTelegramBotRow, candidateId: string, jobId: string | null): Promise<string> {
  const cand = await db.query.candidate.findFirst({
    where: eq(candidateTable.id, candidateId),
    columns: { firstName: true, displayName: true },
  })
  const jobRow = jobId
    ? await db.query.job.findFirst({ where: eq(jobTable.id, jobId), columns: { title: true } })
    : null
  const name = cand?.firstName || cand?.displayName || ''
  if (bot.welcomeMessage?.trim()) {
    return bot.welcomeMessage
      .replaceAll('{name}', name || 'кандидат')
      .replaceAll('{job}', jobRow?.title ?? 'вакансия')
  }
  const hello = name ? `Здравствуйте, ${name}!` : 'Здравствуйте!'
  const jobPart = jobRow?.title ? ` по вакансии «${jobRow.title}»` : ''
  return `${hello} Это чат${jobPart}. Здесь можно задавать вопросы и получать обновления по вашему отклику. Мы на связи!`
}

// ── Входящее сообщение кандидата ─────────────────────────────────────────

interface TgAttachmentMeta {
  kind: 'photo' | 'document' | 'voice' | 'video'
  name: string
  mimeType: string | null
  size: number | null
  s3Key: string | null
}

async function handleInbound(
  eventRowId: string,
  organizationId: string,
  bot: CommsTelegramBotRow,
  msg: TgMessage,
  text: string,
): Promise<void> {
  const chatId = String(msg.chat.id)
  const conv = await db.query.commsConversation.findFirst({
    where: and(
      eq(commsConversation.organizationId, organizationId),
      eq(commsConversation.channel, 'telegram'),
      eq(commsConversation.externalChatId, chatId),
    ),
  })
  if (!conv) {
    // Незнакомый чат — игнорируем (анти-спам), Telegram не ретраит после 200
    await finishEvent(eventRowId, 'skipped', 'no_conversation')
    return
  }

  const attachments = await collectAttachments(bot, conv, msg)
  if (!text && attachments.length === 0) {
    await finishEvent(eventRowId, 'skipped', 'no_content')
    return
  }

  const senderName = msg.from
    ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || msg.from.username || null
    : null
  const externalCreatedAt = msg.date ? new Date(msg.date * 1000) : new Date()

  const insertedMsg = await db.insert(commsMessage)
    .values({
      organizationId,
      conversationId: conv.id,
      externalMessageId: String(msg.message_id),
      direction: 'in',
      senderType: 'candidate',
      senderName,
      body: text || null,
      attachments: attachments.length > 0 ? attachments : null,
      status: 'received',
      externalCreatedAt,
    })
    .onConflictDoNothing()
    .returning({ id: commsMessage.id })
  if (!insertedMsg[0]) {
    // Дубль (ретрай Telegram) — уже приняли
    await finishEvent(eventRowId, 'skipped', 'duplicate_message')
    return
  }

  await db.update(commsConversation)
    .set({
      lastMessageAt: externalCreatedAt,
      lastMessagePreview: preview(text) ?? (attachments.length > 0 ? '📎' : null),
      lastMessageDirection: 'in',
      unreadCount: sql`${commsConversation.unreadCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(commsConversation.id, conv.id))

  // Чат 2.0: автопилот/суфлёр — best-effort
  try {
    await maybeTriggerAutopilot(conv.id)
  }
  catch (err) {
    logWarn('comms.autopilot_trigger_failed', {
      conversation_id: conv.id,
      error_message: err instanceof Error ? err.message : String(err),
    })
  }

  await finishEvent(eventRowId, 'processed')
  logInfo('comms.tg_message_ingested', {
    conversation_id: conv.id,
    organization_id: organizationId,
    has_attachments: attachments.length > 0,
    module: 'comms',
  })
}

/** Скачивает медиа из Telegram в S3. Ошибки не валят ингест текста. */
async function collectAttachments(
  bot: CommsTelegramBotRow,
  conv: CommsConversationRow,
  msg: TgMessage,
): Promise<TgAttachmentMeta[]> {
  const wanted: Array<{ kind: TgAttachmentMeta['kind'], fileId: string, name: string, mimeType: string | null, size: number | null }> = []

  if (msg.photo?.length) {
    // Telegram шлёт варианты размеров — берём самый большой
    const best = [...msg.photo].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0]
    if (best) wanted.push({ kind: 'photo', fileId: best.file_id, name: 'photo.jpg', mimeType: 'image/jpeg', size: best.file_size ?? null })
  }
  if (msg.document) {
    wanted.push({
      kind: 'document',
      fileId: msg.document.file_id,
      name: msg.document.file_name ?? 'document',
      mimeType: msg.document.mime_type ?? null,
      size: msg.document.file_size ?? null,
    })
  }
  if (msg.voice) {
    wanted.push({ kind: 'voice', fileId: msg.voice.file_id, name: 'voice.ogg', mimeType: msg.voice.mime_type ?? 'audio/ogg', size: msg.voice.file_size ?? null })
  }
  if (msg.video) {
    wanted.push({ kind: 'video', fileId: msg.video.file_id, name: msg.video.file_name ?? 'video.mp4', mimeType: msg.video.mime_type ?? 'video/mp4', size: msg.video.file_size ?? null })
  }
  if (wanted.length === 0) return []

  const token = getBotToken(bot)
  const out: TgAttachmentMeta[] = []
  for (const item of wanted) {
    let s3Key: string | null = null
    try {
      const file = await tgDownloadFile(token, item.fileId)
      if (file) {
        const ext = file.filePath.includes('.') ? file.filePath.slice(file.filePath.lastIndexOf('.')) : ''
        const safeName = item.name.replace(/[^\w.\-]+/g, '_').slice(0, 80)
        s3Key = `comms/telegram/${conv.id}/${Date.now()}_${safeName}${safeName.includes('.') ? '' : ext}`
        await uploadToS3(s3Key, file.buffer, item.mimeType ?? 'application/octet-stream')
      }
    }
    catch (err) {
      logWarn('comms.tg_attachment_failed', {
        conversation_id: conv.id,
        kind: item.kind,
        error_message: err instanceof Error ? err.message : String(err),
      })
    }
    out.push({ kind: item.kind, name: item.name, mimeType: item.mimeType, size: item.size, s3Key })
  }
  return out
}
