/**
 * PUT /api/comms/telegram-bot — подключение/обновление Telegram-бота организации.
 *
 * Принимает токен от BotFather (и/или настройки). Проверяет токен через
 * getMe, шифрует, ставит вебхук с secret_token и сохраняет. Идемпотентно:
 * повторный вызов с новым токеном перепривязывает бота.
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { commsTelegramBot } from '../../database/schema'
import {
  buildTelegramWebhookUrl,
  encryptBotToken,
  generateTelegramSecret,
  getBotToken,
  getTelegramBotForOrg,
  tgGetMe,
  tgSetWebhook,
} from '../../utils/comms/telegram'

const bodySchema = z.object({
  botToken: z.string().trim().regex(/^\d+:[\w-]{30,}$/, 'Неверный формат токена бота').optional(),
  enabled: z.boolean().optional(),
  welcomeMessage: z.string().trim().max(2000).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  const existing = await getTelegramBotForOrg(orgId)

  // ── Вариант 1: пришёл новый токен — полное (пере)подключение ──
  if (body.botToken) {
    let me
    try {
      me = await tgGetMe(body.botToken)
    }
    catch {
      throw createError({ statusCode: 400, statusMessage: 'Telegram не принял токен. Проверьте токен у BotFather.' })
    }
    if (!me.is_bot || !me.username) {
      throw createError({ statusCode: 400, statusMessage: 'Токен не принадлежит боту' })
    }

    const secret = existing?.webhookSecret ?? generateTelegramSecret()
    const webhookUrl = buildTelegramWebhookUrl(secret)
    try {
      await tgSetWebhook(body.botToken, webhookUrl, secret)
    }
    catch (err) {
      logError('comms.tg_set_webhook_failed', {
        organization_id: orgId,
        error_message: err instanceof Error ? err.message : String(err),
      })
      throw createError({ statusCode: 502, statusMessage: 'Не удалось установить вебхук Telegram. Попробуйте ещё раз.' })
    }

    const values = {
      botTokenEncrypted: encryptBotToken(body.botToken),
      botUsername: me.username,
      botTgId: String(me.id),
      webhookSecret: secret,
      enabled: body.enabled ?? true,
      ...(body.welcomeMessage !== undefined ? { welcomeMessage: body.welcomeMessage } : {}),
      updatedAt: new Date(),
    }
    if (existing) {
      await db.update(commsTelegramBot).set(values).where(eq(commsTelegramBot.id, existing.id))
    }
    else {
      await db.insert(commsTelegramBot).values({ organizationId: orgId, ...values })
    }

    await recordActivity({
      organizationId: orgId,
      actorId: session.user.id,
      action: existing ? 'updated' : 'created',
      resourceType: 'telegram_bot',
      resourceId: orgId,
      metadata: { bot_username: me.username },
    })
    logInfo('comms.tg_bot_connected', { organization_id: orgId, bot_username: me.username, module: 'comms' })
    return { ok: true, botUsername: me.username }
  }

  // ── Вариант 2: правка настроек без токена ──
  if (!existing) {
    throw createError({ statusCode: 400, statusMessage: 'Сначала подключите бота (нужен токен)' })
  }
  await db.update(commsTelegramBot)
    .set({
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.welcomeMessage !== undefined ? { welcomeMessage: body.welcomeMessage } : {}),
      updatedAt: new Date(),
    })
    .where(eq(commsTelegramBot.id, existing.id))

  // Спринт 19.5: при включении переустанавливаем вебхук — у ботов,
  // подключённых до 19.5, в allowed_updates нет событий Telegram Business
  if (body.enabled === true) {
    try {
      await tgSetWebhook(getBotToken(existing), buildTelegramWebhookUrl(existing.webhookSecret), existing.webhookSecret)
    }
    catch (err) {
      logWarn('comms.tg_refresh_webhook_failed', {
        organization_id: orgId,
        error_message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { ok: true, botUsername: existing.botUsername }
})
