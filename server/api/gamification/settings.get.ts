import { eq } from 'drizzle-orm'
import { gamificationSettings, commsTelegramBot } from '../../database/schema'

/** GET /api/gamification/settings — MVP-push config + whether a Telegram bot is set up. */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })

  const settings = await db.query.gamificationSettings.findFirst({
    where: eq(gamificationSettings.organizationId, orgId),
  })
  const bot = await db.query.commsTelegramBot.findFirst({
    where: eq(commsTelegramBot.organizationId, orgId),
  })

  return {
    mvpEnabled: settings?.mvpEnabled ?? false,
    mvpTelegramChatId: settings?.mvpTelegramChatId ?? null,
    telegramBotConfigured: !!bot,
    botUsername: bot?.botUsername ?? null,
  }
})
