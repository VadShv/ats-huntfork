/**
 * GET /api/hh/negotiations/:id/messages
 *
 * Загружает переписку (сообщения) по конкретному отклику напрямую из hh.ru.
 * Прокси-эндпоинт: локально сообщения не хранятся — каждый раз идём в API hh.
 */
import { and, eq } from 'drizzle-orm'
import { hhNegotiation, hhVacancyLink } from '../../../../database/schema'
import { apiGet } from '../../../../utils/hh/client'
import { resolveHhConfig } from '../../../../utils/hh/config'
import { getValidAccessToken } from '../../../../utils/hh/tokens'

interface HhMessagesResponse {
  items?: Array<Record<string, unknown>>
  found?: number
  [key: string]: unknown
}

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhNegotiation: ['read'] })
  const orgId = session.activeOrganizationId
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id обязателен' })
  }

  // Грузим negotiation, проверяем принадлежность к org
  const negRows = await db
    .select({
      id: hhNegotiation.id,
      hhNegotiationId: hhNegotiation.hhNegotiationId,
      hhVacancyLinkId: hhNegotiation.hhVacancyLinkId,
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

  const config = await resolveHhConfig(orgId)

  let token: string
  try {
    token = await getValidAccessToken(link.hhAccountId)
  }
  catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `Не удалось получить токен hh.ru: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  try {
    const data = await apiGet<HhMessagesResponse>(
      `/negotiations/${neg.hhNegotiationId}/messages`,
      token,
      undefined,
      config,
    )
    return data.items ?? []
  }
  catch (err) {
    const status = (err as Error & { status?: number }).status ?? 502
    throw createError({
      statusCode: status,
      statusMessage: `Ошибка hh.ru: ${err instanceof Error ? err.message : String(err)}`,
      data: { hhStatus: (err as Error & { status?: number }).status },
    })
  }
})
