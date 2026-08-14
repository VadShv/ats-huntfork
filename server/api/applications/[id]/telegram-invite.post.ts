/**
 * POST /api/applications/:id/telegram-invite
 *
 * Генерирует персональную ссылку-приглашение кандидата в Telegram-чат:
 * t.me/<bot>?start=<токен>. Токен одноразовый по смыслу (повторный /start
 * перепривязывает диалог), живёт 14 дней. Переиспользуем действующий
 * неиспользованный токен, чтобы не плодить строки.
 */
import { z } from 'zod'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { application, commsTelegramLinkToken } from '../../../database/schema'
import { buildTelegramInviteLink, generateTelegramSecret, getTelegramBotForOrg } from '../../../utils/comms/telegram'

const paramsSchema = z.object({ id: z.string().min(1) })

const INVITE_TTL_DAYS = 14

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const { id: applicationId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const bot = await getTelegramBotForOrg(orgId)
  if (!bot || !bot.enabled) {
    throw createError({ statusCode: 400, statusMessage: 'Telegram-бот не подключён. Подключите его в Настройки → Интеграции.' })
  }

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    columns: { id: true, candidateId: true, jobId: true },
  })
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }

  // Действующий неиспользованный токен по этому отклику — переиспользуем
  const existing = await db.query.commsTelegramLinkToken.findFirst({
    where: and(
      eq(commsTelegramLinkToken.organizationId, orgId),
      eq(commsTelegramLinkToken.applicationId, app.id),
      isNull(commsTelegramLinkToken.usedAt),
      gt(commsTelegramLinkToken.expiresAt, new Date()),
    ),
    orderBy: [desc(commsTelegramLinkToken.createdAt)],
  })
  if (existing) {
    return {
      link: buildTelegramInviteLink(bot.botUsername, existing.token),
      botUsername: bot.botUsername,
      expiresAt: existing.expiresAt.toISOString(),
    }
  }

  const token = generateTelegramSecret()
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
  await db.insert(commsTelegramLinkToken).values({
    organizationId: orgId,
    token,
    candidateId: app.candidateId,
    applicationId: app.id,
    jobId: app.jobId,
    createdById: session.user.id,
    expiresAt,
  })

  logInfo('comms.tg_invite_created', {
    application_id: app.id,
    candidate_id: app.candidateId,
    organization_id: orgId,
    module: 'comms',
  })

  return {
    link: buildTelegramInviteLink(bot.botUsername, token),
    botUsername: bot.botUsername,
    expiresAt: expiresAt.toISOString(),
  }
})
