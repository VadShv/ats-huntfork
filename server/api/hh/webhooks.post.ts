/**
 * POST /api/hh/webhooks — включить вебхуки hh.ru для аккаунта текущего пользователя.
 *
 * Генерирует секрет, оформляет подписку в hh.ru (или обновляет существующую)
 * на события: новое сообщение в чате, новый отклик/приглашение, смена статуса
 * отклика работодателем. Один URL на пару пользователь+приложение.
 */
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { hhAccount } from '../../database/schema'
import { env } from '../../utils/env'
import { apiGet, apiRequest, isHhConfigured } from '../../utils/hh/client'
import { getHhAccountForUser, getValidAccessToken } from '../../utils/hh/tokens'

const WEBHOOK_ACTIONS = [
  { type: 'CHAT_MESSAGE_CREATED' },
  { type: 'NEW_RESPONSE_OR_INVITATION_VACANCY' },
  { type: 'NEGOTIATION_EMPLOYER_STATE_CHANGE' },
]

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  if (!isHhConfigured() || !env.HH_REDIRECT_URI) {
    throw createError({ statusCode: 400, statusMessage: 'Интеграция hh.ru не настроена' })
  }

  const account = await getHhAccountForUser(session.session.activeOrganizationId, session.user.id)
  if (!account || !account.isActive) {
    throw createError({ statusCode: 400, statusMessage: 'Аккаунт hh.ru не подключён' })
  }

  const accessToken = await getValidAccessToken(account.id)

  const secret = account.webhookSecret ?? randomBytes(24).toString('hex')
  const baseUrl = new URL(env.HH_REDIRECT_URI).origin
  const url = `${baseUrl}/api/webhooks/hh/${secret}`

  let subscriptionId = account.webhookSubscriptionId

  try {
    if (subscriptionId) {
      // Обновляем существующую подписку (идемпотентно)
      await apiRequest('PUT', `/webhook/subscriptions/${subscriptionId}`, accessToken, {
        body: { url, actions: WEBHOOK_ACTIONS },
      })
    }
    else {
      const created = await apiRequest<{ id?: string | number }>('POST', '/webhook/subscriptions', accessToken, {
        body: { url, actions: WEBHOOK_ACTIONS },
      })
      subscriptionId = created.body?.id != null ? String(created.body.id) : null
      if (!subscriptionId) {
        // Некоторые ответы hh не содержат тело — добираем из списка подписок
        const list = await apiGet<{ items?: Array<{ id?: string | number }> }>('/webhook/subscriptions', accessToken)
        subscriptionId = list?.items?.[0]?.id != null ? String(list.items[0].id) : null
      }
    }
  }
  catch (err) {
    const status = (err as { status?: number }).status
    logError('comms.hh_webhook_subscribe_failed', {
      hh_account_id: account.id,
      status_code: status ?? null,
      error_message: err instanceof Error ? err.message : String(err),
      module: 'comms',
    })
    throw createError({
      statusCode: 502,
      statusMessage: 'hh.ru отклонил оформление подписки на вебхуки',
    })
  }

  await db.update(hhAccount)
    .set({
      webhookSecret: secret,
      webhookSubscriptionId: subscriptionId,
      webhookEnabledAt: new Date(),
    })
    .where(eq(hhAccount.id, account.id))

  logInfo('comms.hh_webhook_subscribed', {
    hh_account_id: account.id,
    subscription_id: subscriptionId,
    module: 'comms',
  })

  return { enabled: true, subscriptionId }
})
