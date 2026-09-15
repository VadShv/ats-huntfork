/**
 * GET /api/hh/stats/org
 *
 * Org-wide aggregated funnel stats + 30-day trend.
 */
import { collectOrgStats, getStatsTrend } from '../../../utils/hh/stats'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhStats: ['read'] })
  const orgId = session.activeOrganizationId

  const current = await collectOrgStats(orgId)

  const dateTo = new Date().toISOString().slice(0, 10)
  const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const trend = await getStatsTrend({ orgId, dateFrom, dateTo })

  return { current, trend }
})
