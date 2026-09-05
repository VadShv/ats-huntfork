import { and, eq, sql } from 'drizzle-orm'
import { gamificationTeam } from '../../database/schema'

/**
 * GET /api/teams — teams with members (names). Also returns org recruiters
 * not yet on a team, for the assignment UI.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })

  const teams = await db.query.gamificationTeam.findMany({
    where: and(eq(gamificationTeam.organizationId, orgId), eq(gamificationTeam.isArchived, false)),
    with: { members: true },
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  })

  // All org recruiters (members)
  const people = await db.execute<{ id: string, name: string }>(sql`
    SELECT u.id, COALESCE(u.name, u.email) AS name
    FROM member m JOIN "user" u ON u.id = m.user_id
    WHERE m.organization_id = ${orgId}
  `)
  const nameById = new Map((people as any[]).map(p => [p.id, p.name]))
  const assigned = new Set(teams.flatMap(t => t.members.map(m => m.userId)))

  return {
    teams: teams.map(t => ({
      id: t.id, name: t.name, color: t.color,
      members: t.members.map(m => ({ userId: m.userId, name: nameById.get(m.userId) ?? '—' })),
    })),
    unassigned: (people as any[]).filter(p => !assigned.has(p.id)).map(p => ({ userId: p.id, name: p.name })),
  }
})
