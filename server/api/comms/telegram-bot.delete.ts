/**
 * DELETE /api/comms/telegram-bot — отключение Telegram-бота организации.
 * Снимает вебхук (best-effort) и удаляет запись. Диалоги и сообщения
 * НЕ удаляем — история остаётся, отправка станет недоступна.
 */
import { eq } from 'drizzle-orm'
import { commsTelegramBot } from '../../database/schema'
import { getBotToken, getTelegramBotForOrg, tgDeleteWebhook } from '../../utils/comms/telegram'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId

  const bot = await getTelegramBotForOrg(orgId)
  if (!bot) return { ok: true }

  try {
    await tgDeleteWebhook(getBotToken(bot))
  }
  catch (err) {
    // Токен мог быть отозван в BotFather — не мешаем отключению
    logWarn('comms.tg_delete_webhook_failed', {
      organization_id: orgId,
      error_message: err instanceof Error ? err.message : String(err),
    })
  }

  await db.delete(commsTelegramBot).where(eq(commsTelegramBot.id, bot.id))

  await recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'deleted',
    resourceType: 'telegram_bot',
    resourceId: orgId,
    metadata: { bot_username: bot.botUsername },
  })
  logInfo('comms.tg_bot_disconnected', { organization_id: orgId, module: 'comms' })
  return { ok: true }
})
