/**
 * Team league — teams ranked by average RP per member (fair to team size).
 * Reuses the individual RP engine (computeOrgRp) within the current season.
 */
import { and, eq, sql } from 'drizzle-orm'
import { gamificationTeam } from '../../database/schema'
import { getOrCreateCurrentSeason } from '../huntpass/season'
import { computeOrgRp } from '../ranks/rp'

export interface TeamStanding {
  teamId: string
  name: string
  color: string
  memberCount: number
  totalRp: number
  avgRp: number
  topContributor: { userId: string, name: string, rp: number } | null
}

export async function computeLeague(orgId: string): Promise<{ season: { name: string }, standings: TeamStanding[], myTeamId: string | null }> {
  const s = await getOrCreateCurrentSeason()
  const rpMap = await computeOrgRp(orgId, s.startsAt.toISOString(), s.endsAt.toISOString())

  const teams = await db.query.gamificationTeam.findMany({
    where: and(eq(gamificationTeam.organizationId, orgId), eq(gamificationTeam.isArchived, false)),
    with: { members: true },
  })

  // Names for member users
  const memberIds = teams.flatMap(t => t.members.map(m => m.userId))
  const names = new Map<string, string>()
  if (memberIds.length) {
    const rows = await db.execute<{ id: string, name: string }>(sql`
      SELECT id, COALESCE(name, email) AS name FROM "user"
      WHERE id IN (${sql.join(memberIds.map(id => sql`${id}`), sql`, `)})
    `)
    for (const r of rows as any[]) names.set(r.id, r.name)
  }

  const standings: TeamStanding[] = teams.map((t) => {
    let totalRp = 0
    let top: { userId: string, name: string, rp: number } | null = null
    for (const m of t.members) {
      const rp = rpMap.get(m.userId)?.rp ?? 0
      totalRp += rp
      if (!top || rp > top.rp) top = { userId: m.userId, name: names.get(m.userId) ?? '—', rp }
    }
    const memberCount = t.members.length
    return {
      teamId: t.id, name: t.name, color: t.color, memberCount, totalRp,
      avgRp: memberCount > 0 ? Math.round(totalRp / memberCount) : 0,
      topContributor: top,
    }
  })

  standings.sort((a, b) => b.avgRp - a.avgRp || b.totalRp - a.totalRp)
  return { season: { name: s.name }, standings, myTeamId: null }
}
