import { and, eq, or, sql } from 'drizzle-orm'
import { referral } from '../../database/schema'

/** GET /api/referrals — my referrals (incoming pending, sent, recent). */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id

  const rows = await db.query.referral.findMany({
    where: and(eq(referral.organizationId, orgId), or(eq(referral.fromUserId, userId), eq(referral.toUserId, userId))),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 40,
  })

  // Names & candidate labels
  const userIds = [...new Set(rows.flatMap(r => [r.fromUserId, r.toUserId]))]
  const candIds = [...new Set(rows.map(r => r.candidateId))]
  const names = new Map<string, string>()
  const cands = new Map<string, string>()
  if (userIds.length) {
    const nr = await db.execute<{ id: string, name: string }>(sql`
      SELECT id, COALESCE(name, email) AS name FROM "user" WHERE id IN (${sql.join(userIds.map(i => sql`${i}`), sql`, `)})
    `)
    for (const n of nr as any[]) names.set(n.id, n.name)
  }
  if (candIds.length) {
    const cr = await db.execute<{ id: string, name: string }>(sql`
      SELECT id, TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) AS name
      FROM candidate WHERE id IN (${sql.join(candIds.map(i => sql`${i}`), sql`, `)})
    `)
    for (const c of cr as any[]) cands.set(c.id, c.name || 'Кандидат')
  }

  const map = (r: typeof rows[number]) => ({
    id: r.id,
    status: r.status,
    candidateId: r.candidateId,
    candidateName: cands.get(r.candidateId) ?? 'Кандидат',
    fromUserId: r.fromUserId,
    fromName: names.get(r.fromUserId) ?? '—',
    toUserId: r.toUserId,
    toName: names.get(r.toUserId) ?? '—',
    note: r.note,
    createdAt: r.createdAt,
  })

  return {
    incoming: rows.filter(r => r.toUserId === userId && r.status === 'pending').map(map),
    sent: rows.filter(r => r.fromUserId === userId).map(map),
  }
})
