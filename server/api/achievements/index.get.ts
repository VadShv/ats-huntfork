import { getLevel } from '../../../shared/achievements-catalog'
import { checkAchievements } from '../../utils/achievements/check'

/**
 * GET /api/achievements
 *
 * Returns all achievements with current progress + earned status for the
 * authenticated user. Also awards newly-earned achievements (fire-and-forget).
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { achievements, newlyEarned, totalXp } = await checkAchievements(userId, orgId, true)
  const level = getLevel(totalXp)

  return {
    achievements,
    level,
    newlyEarned: newlyEarned.map(a => ({ key: a.key, name: a.name, icon: a.icon, points: a.points })),
  }
})
