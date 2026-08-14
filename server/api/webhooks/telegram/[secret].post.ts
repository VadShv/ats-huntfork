/**
 * POST /api/webhooks/telegram/[secret]
 *
 * Приёмник вебхуков Telegram Bot API. Эндпоинт ПУБЛИЧНЫЙ.
 * Безопасность двойная:
 *   1) секрет в URL сверяется с comms_telegram_bot.webhook_secret;
 *   2) заголовок X-Telegram-Bot-Api-Secret-Token (задаётся в setWebhook)
 *      должен совпадать с тем же секретом.
 *
 * Как и hh: быстрый ACK ≤ 5 сек — только журнал (с дедупликацией по
 * update_id) + постановка в очередь. Обработка — в воркере
 * (utils/comms/telegramWebhooks.ts).
 */
import { eq } from 'drizzle-orm'
import { commsChannelEvent, commsTelegramBot } from '../../../database/schema'
import { enqueueTelegramWebhookEvent, type TgUpdateEnvelope } from '../../../utils/comms/telegramWebhooks'

export default defineEventHandler(async (event) => {
  const secret = getRouterParam(event, 'secret')
  if (!secret || secret.length < 16) {
    throw createError({ statusCode: 404, statusMessage: 'Не найдено' })
  }

  const bot = await db.query.commsTelegramBot.findFirst({
    where: eq(commsTelegramBot.webhookSecret, secret),
    columns: { id: true, organizationId: true, enabled: true },
  })
  if (!bot) {
    throw createError({ statusCode: 404, statusMessage: 'Не найдено' })
  }

  // Вторая линия: Telegram присылает secret_token в заголовке
  const headerSecret = getHeader(event, 'x-telegram-bot-api-secret-token')
  if (headerSecret !== secret) {
    throw createError({ statusCode: 404, statusMessage: 'Не найдено' })
  }

  const body = await readBody<TgUpdateEnvelope>(event).catch(() => null)
  if (!body || typeof body.update_id !== 'number') {
    // Не даём Telegram ретраить заведомо нечитаемое событие
    logWarn('comms.tg_webhook_malformed', { bot_id: bot.id, module: 'comms' })
    setResponseStatus(event, 200)
    return { ok: false }
  }

  // Отметка живости вебхука (не критично при гонках)
  db.update(commsTelegramBot)
    .set({ webhookLastEventAt: new Date() })
    .where(eq(commsTelegramBot.id, bot.id))
    .catch(() => {})

  // Журнал + дедуп: update_id уникален в рамках бота (частичный уникальный
  // индекс (org, channel, type, external_event_id) из миграции 0053)
  const inserted = await db.insert(commsChannelEvent)
    .values({
      organizationId: bot.organizationId,
      channel: 'telegram',
      externalEventId: String(body.update_id),
      type: 'update',
      payload: body,
      status: 'received',
    })
    .onConflictDoNothing()
    .returning({ id: commsChannelEvent.id })

  const row = inserted[0]
  if (!row) {
    setResponseStatus(event, 200)
    return { ok: true, duplicate: true }
  }

  await enqueueTelegramWebhookEvent(row.id)

  setResponseStatus(event, 200)
  return { ok: true }
})
