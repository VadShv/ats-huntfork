import { runRankTickForOrg } from '../../utils/ranks/tick'

/**
 * POST /api/rank/tick
 * Manually run the rank ladder tick for the current org (owner/admin).
 * Same logic as the weekly scheduled task; useful for immediate updates/testing.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })

  const updated = await runRankTickForOrg(orgId)
  return { success: true, updated }
})
