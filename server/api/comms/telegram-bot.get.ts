/**
 * GET /api/comms/telegram-bot — статус Telegram-бота организации.
 * Токен НИКОГДА не возвращаем — только метаданные.
 * Спринт 19.5: + список business-подключений (личные аккаунты рекрутеров).
 */
import { eq } from 'drizzle-orm'
import { commsTelegramBusinessConnection } from '../../database/schema'
import { getTelegramBotForOrg } from '../../utils/comms/telegram'
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  const bot = await getTelegramBotForOrg(orgId)
  if (!bot) return { connected: false }

  const businessConnections = await db.query.commsTelegramBusinessConnection.findMany({
    where: eq(commsTelegramBusinessConnection.organizationId, orgId),
  })

  return {
    connected: true,
    enabled: bot.enabled,
    botUsername: bot.botUsername,
    welcomeMessage: bot.welcomeMessage,
    webhookLastEventAt: bot.webhookLastEventAt?.toISOString() ?? null,
    createdAt: bot.createdAt.toISOString(),
    businessConnections: businessConnections.map(c => ({
      id: c.id,
      tgUsername: c.tgUsername,
      displayName: c.displayName,
      enabled: c.enabled,
      canReply: c.canReply,
      connectedAt: c.connectedAt.toISOString(),
    })),
  }
})
