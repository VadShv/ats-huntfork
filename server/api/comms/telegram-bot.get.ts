/**
 * GET /api/comms/telegram-bot — статус Telegram-бота организации.
 * Токен НИКОГДА не возвращаем — только метаданные.
 */
import { getTelegramBotForOrg } from '../../utils/comms/telegram'
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  const bot = await getTelegramBotForOrg(orgId)
  if (!bot) return { connected: false }

  return {
    connected: true,
    enabled: bot.enabled,
    botUsername: bot.botUsername,
    welcomeMessage: bot.welcomeMessage,
    webhookLastEventAt: bot.webhookLastEventAt?.toISOString() ?? null,
    createdAt: bot.createdAt.toISOString(),
  }
})
