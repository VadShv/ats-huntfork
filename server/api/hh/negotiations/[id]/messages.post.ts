/**
 * POST /api/hh/negotiations/:id/messages  body: { messageText }
 *
 * Отправляет сообщение кандидату от лица работодателя через hh.ru.
 * Делегирует в sendNegotiationMessage из pushAction — там идемпотентность
 * и логирование в hh_action_log.
 */
import { and, eq } from 'drizzle-orm'
import { hhNegotiation, hhVacancyLink } from '../../../../database/schema'
import { sendNegotiationMessage } from '../../../../utils/hh/sourcing/pushAction'

export default defineEventHandler(async (event) => {
  const { session, user } = await requirePermission(event, { hhNegotiation: ['sync'] })
  const orgId = session.activeOrganizationId
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id обязателен' })
  }

  const body = await readBody<{ messageText?: string }>(event)
  const messageText = body?.messageText?.trim()
  if (!messageText) {
    throw createError({ statusCode: 400, statusMessage: 'messageText обязателен' })
  }

  // Грузим negotiation, проверяем принадлежность к org
  const negRows = await db
    .select({
      id: hhNegotiation.id,
      hhNegotiationId: hhNegotiation.hhNegotiationId,
      hhVacancyLinkId: hhNegotiation.hhVacancyLinkId,
      applicationId: hhNegotiation.applicationId,
    })
    .from(hhNegotiation)
    .where(and(
      eq(hhNegotiation.id, id),
      eq(hhNegotiation.organizationId, orgId),
    ))
    .limit(1)
  const neg = negRows[0]
  if (!neg) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }

  // Резолвим link → hhAccountId
  const linkRows = await db
    .select({ hhAccountId: hhVacancyLink.hhAccountId })
    .from(hhVacancyLink)
    .where(and(
      eq(hhVacancyLink.id, neg.hhVacancyLinkId),
      eq(hhVacancyLink.organizationId, orgId),
    ))
    .limit(1)
  const link = linkRows[0]
  if (!link) {
    throw createError({ statusCode: 404, statusMessage: 'Связь с hh.ru не найдена' })
  }

  let result: { sent: boolean }
  try {
    result = await sendNegotiationMessage({
      organizationId: orgId,
      hhAccountId: link.hhAccountId,
      negotiationId: neg.hhNegotiationId,
      messageText,
      userId: user.id,
      applicationId: neg.applicationId,
    })
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `Не удалось отправить на hh.ru: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  return { sent: result.sent }
})
