/**
 * POST /api/hh/stats/refresh
 *
 * Force a stats snapshot for the current org (admin action).
 * Useful for testing or getting fresh data outside the daily schedule.
 */
import { snapshotStats } from '../../../utils/hh/stats'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhStats: ['refresh'] })
  const orgId = session.activeOrganizationId

  await snapshotStats(orgId)

  return { success: true, message: 'Снимок метрик обновлён' }
})
