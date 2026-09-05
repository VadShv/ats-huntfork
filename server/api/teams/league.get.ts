import { and, eq } from 'drizzle-orm'
import { gamificationTeamMember } from '../../database/schema'
import { computeLeague } from '../../utils/teams/league'

/** GET /api/teams/league — team standings by average RP per member. */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id

  const league = await computeLeague(orgId)

  // My team (for highlighting)
  const mine = await db.query.gamificationTeamMember.findFirst({
    where: and(eq(gamificationTeamMember.organizationId, orgId), eq(gamificationTeamMember.userId, userId)),
  })

  return {
    season: league.season,
    standings: league.standings.map((t, i) => ({ rank: i + 1, ...t })),
    myTeamId: mine?.teamId ?? null,
  }
})
