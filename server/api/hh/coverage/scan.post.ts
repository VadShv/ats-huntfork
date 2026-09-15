/**
 * POST /api/hh/coverage/scan
 *
 * Manually trigger coverage gap detection for the current org.
 */
import { detectAllCoverageGaps } from '../../../utils/hh/coverage'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhStats: ['refresh'] })

  await detectAllCoverageGaps(session.activeOrganizationId)

  return { success: true }
})
