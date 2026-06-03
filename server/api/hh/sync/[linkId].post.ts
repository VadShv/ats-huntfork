/**
 * POST /api/hh/sync/:linkId
 *
 * Запускает синхронизацию откликов для одной связанной с hh.ru вакансии.
 * Доступно только для текущей организации пользователя.
 */
import { and, eq } from 'drizzle-orm'
import { hhVacancyLink } from '../../../database/schema'
import { syncVacancyLink } from '../../../utils/hh/sync'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const linkId = getRouterParam(event, 'linkId')
  if (!linkId) {
    throw createError({ statusCode: 400, statusMessage: 'linkId обязателен' })
  }

  const rows = await db
    .select({ id: hhVacancyLink.id })
    .from(hhVacancyLink)
    .where(and(
      eq(hhVacancyLink.id, linkId),
      eq(hhVacancyLink.organizationId, session.session.activeOrganizationId),
    ))
    .limit(1)
  if (rows.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Связь не найдена' })
  }

  const result = await syncVacancyLink(linkId)
  return result
})
