/**
 * GET /api/hh/stats/vacancy/:linkId
 *
 * Current funnel stats for a single linked vacancy + 30-day trend.
 */
import { and, eq } from 'drizzle-orm'
import { hhVacancyLink } from '../../../../database/schema'
import { collectVacancyStats, getStatsTrend } from '../../../../utils/hh/stats'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhStats: ['read'] })
  const orgId = session.activeOrganizationId
  const linkId = getRouterParam(event, 'linkId')

  if (!linkId) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан linkId' })
  }

  // Verify the link belongs to this org
  const [link] = await db
    .select({ id: hhVacancyLink.id, jobId: hhVacancyLink.jobId })
    .from(hhVacancyLink)
    .where(and(eq(hhVacancyLink.id, linkId), eq(hhVacancyLink.organizationId, orgId)))
    .limit(1)
  if (!link) {
    throw createError({ statusCode: 404, statusMessage: 'Связь с hh.ru не найдена' })
  }

  const current = await collectVacancyStats(linkId)

  const dateTo = new Date().toISOString().slice(0, 10)
  const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const trend = await getStatsTrend({ orgId, vacancyLinkId: linkId, dateFrom, dateTo })

  return { current, trend }
})
