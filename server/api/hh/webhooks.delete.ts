/**
 * DELETE /api/hh/webhooks — выключить вебхуки hh.ru для аккаунта текущего пользователя.
 *
 * Снимает подписку в hh.ru и очищает поля на hh_account. Секрет тоже
 * обнуляется — старый URL сразу перестаёт приниматься (404).
 */
import { eq } from 'drizzle-orm'
import { hhAccount } from '../../database/schema'
import { apiRequest } from '../../utils/hh/client'
import { getHhAccountForUser, getValidAccessToken } from '../../utils/hh/tokens'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const account = await getHhAccountForUser(session.session.activeOrganizationId, session.user.id)
  if (!account) {
    throw createError({ statusCode: 400, statusMessage: 'Аккаунт hh.ru не подключён' })
  }

  if (account.webhookSubscriptionId) {
    try {
      const accessToken = await getValidAccessToken(account.id)
      await apiRequest('DELETE', `/webhook/subscriptions/${account.webhookSubscriptionId}`, accessToken)
    }
    catch (err) {
      const status = (err as { status?: number }).status
      // 404 — подписки уже нет на стороне hh, это не ошибка
      if (status !== 404) {
        logWarn('comms.hh_webhook_unsubscribe_failed', {
          hh_account_id: account.id,
          status_code: status ?? null,
          error_message: err instanceof Error ? err.message : String(err),
          module: 'comms',
        })
      }
    }
  }

  await db.update(hhAccount)
    .set({
      webhookSecret: null,
      webhookSubscriptionId: null,
      webhookEnabledAt: null,
    })
    .where(eq(hhAccount.id, account.id))

  logInfo('comms.hh_webhook_unsubscribed', {
    hh_account_id: account.id,
    module: 'comms',
  })

  return { enabled: false }
})
