import { and, eq, or, sql } from 'drizzle-orm'
import { duel } from '../../database/schema'
import { GAMIFICATION_CONFIG } from '../../../shared/gamification-config'
import { resolveExpiredDuels, duelScores } from '../../utils/duels/resolve'

/**
 * GET /api/duels — the user's duels (incoming pending, active with live scores,
 * recent completed). Auto-resolves expired active duels first.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id

  // Resolve anything that has ended so scores/winners are up to date.
  await resolveExpiredDuels(orgId)

  const rows = await db.query.duel.findMany({
    where: and(eq(duel.organizationId, orgId), or(eq(duel.challengerId, userId), eq(duel.opponentId, userId))),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 30,
  })

  // Names
  const ids = [...new Set(rows.flatMap(r => [r.challengerId, r.opponentId]))]
  const names = new Map<string, string>()
  if (ids.length) {
    const nr = await db.execute<{ id: string, name: string }>(sql`
      SELECT id, COALESCE(name, email) AS name FROM "user" WHERE id IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})
    `)
    for (const n of nr as any[]) names.set(n.id, n.name)
  }
  const metricLabel = (k: string) => GAMIFICATION_CONFIG.duel.metrics.find(m => m.key === k)?.label ?? k

  const out = []
  for (const r of rows) {
    let cScore = r.challengerScore
    let oScore = r.opponentScore
    if (r.status === 'active') {
      const s = await duelScores(r)
      cScore = s.challenger; oScore = s.opponent
    }
    out.push({
      id: r.id,
      status: r.status,
      metric: r.metric,
      metricLabel: metricLabel(r.metric),
      challengerId: r.challengerId,
      challengerName: names.get(r.challengerId) ?? '—',
      opponentId: r.opponentId,
      opponentName: names.get(r.opponentId) ?? '—',
      challengerScore: cScore,
      opponentScore: oScore,
      winnerId: r.winnerId,
      endsAt: r.endsAt,
      isChallenger: r.challengerId === userId,
      isIncoming: r.opponentId === userId && r.status === 'pending',
    })
  }

  // Org recruiters (potential opponents, excluding self).
  const people = await db.execute<{ id: string, name: string }>(sql`
    SELECT u.id, COALESCE(u.name, u.email) AS name
    FROM member m JOIN "user" u ON u.id = m.user_id
    WHERE m.organization_id = ${orgId} AND m.user_id <> ${userId}
  `)

  return {
    duels: out,
    winSxp: GAMIFICATION_CONFIG.duel.winSxp,
    metrics: GAMIFICATION_CONFIG.duel.metrics,
    opponents: (people as any[]).map(p => ({ userId: p.id, name: p.name })),
  }
})

