/**
 * GET /api/hh/stats/trend
 *
 * Historical trend data with optional date range and vacancy filter.
 * Query: ?vacancyLinkId=...&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 */
import { getStatsTrend } from '../../../utils/hh/stats'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhStats: ['read'] })
  const orgId = session.activeOrganizationId

  const query = getQuery(event)
  const vacancyLinkId = (query.vacancyLinkId as string | undefined) || undefined
  const dateTo = (query.dateTo as string | undefined) || new Date().toISOString().slice(0, 10)
  const dateFrom = (query.dateFrom as string | undefined)
    || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const trend = await getStatsTrend({ orgId, vacancyLinkId, dateFrom, dateTo })

  return { trend }
})
