/**
 * POST /api/webhooks/hh/[secret]
 *
 * Приёмник вебхуков hh.ru. Эндпоинт ПУБЛИЧНЫЙ — hh.ru шлёт неаутентифицированные
 * POST. Безопасность: секрет в URL сверяется с hh_account.webhook_secret
 * (генерируется при включении подписки, знает только hh.ru).
 *
 * Требование hh: ответ 2xx не дольше 5 секунд, иначе ретраи и дубли.
 * Поэтому здесь только: журналирование события (с дедупликацией) + постановка
 * в очередь. Вся обработка — в воркере (см. utils/comms/hhWebhooks.ts).
 */
import { eq } from 'drizzle-orm'
import { commsChannelEvent, hhAccount } from '../../../database/schema'
import { enqueueHhWebhookEvent, type HhWebhookEnvelope } from '../../../utils/comms/hhWebhooks'

export default defineEventHandler(async (event) => {
  const secret = getRouterParam(event, 'secret')
  if (!secret || secret.length < 16) {
    throw createError({ statusCode: 404, statusMessage: 'Не найдено' })
  }

  const account = await db.query.hhAccount.findFirst({
    where: eq(hhAccount.webhookSecret, secret),
    columns: { id: true, organizationId: true, isActive: true },
  })
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Не найдено' })
  }

  const body = await readBody<HhWebhookEnvelope>(event).catch(() => null)
  const actionType = body?.action_type
  if (!body || typeof actionType !== 'string' || !actionType) {
    // Не даём hh ретраить заведомо нечитаемое событие
    logWarn('comms.hh_webhook_malformed', {
      hh_account_id: account.id,
      module: 'comms',
    })
    setResponseStatus(event, 200)
    return { ok: false }
  }

  // Отметка живости подписки (не критично при гонках)
  db.update(hhAccount)
    .set({ webhookLastEventAt: new Date() })
    .where(eq(hhAccount.id, account.id))
    .catch(() => {})

  // Журнал + дедуп: id события уникален в рамках типа для пары пользователь+приложение
  const inserted = await db.insert(commsChannelEvent)
    .values({
      organizationId: account.organizationId,
      channel: 'hh',
      externalEventId: body.id ? String(body.id) : null,
      type: actionType,
      payload: body,
      status: 'received',
    })
    .onConflictDoNothing()
    .returning({ id: commsChannelEvent.id })

  const row = inserted[0]
  if (!row) {
    // Дубль доставки — уже принято ранее
    setResponseStatus(event, 200)
    return { ok: true, duplicate: true }
  }

  await enqueueHhWebhookEvent(row.id)

  setResponseStatus(event, 200)
  return { ok: true }
})
