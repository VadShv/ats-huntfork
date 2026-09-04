import { getUserQuests } from '../../utils/quests'

/**
 * GET /api/quests
 * Daily + weekly quests for the current periods with live progress.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id

  const quests = await getUserQuests(userId, orgId)
  const daily = quests.filter(q => q.type === 'daily')
  const weekly = quests.filter(q => q.type === 'weekly')
  const claimable = quests.filter(q => q.completed && !q.claimed).length

  return { daily, weekly, claimable }
})
