import { checkAchievements } from '../../utils/achievements/check'

/**
 * POST /api/achievements/check
 *
 * Force-check achievements for the authenticated user.
 * Called after stage moves, job closures, or manually.
 * Returns newly-earned achievements (for toast notifications).
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { newlyEarned, totalXp } = await checkAchievements(userId, orgId, true)

  return {
    newlyEarned: newlyEarned.map(a => ({ key: a.key, name: a.name, icon: a.icon, points: a.points })),
    totalXp,
  }
})
