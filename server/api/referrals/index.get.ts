import { and, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { referral } from '../../database/schema'

const querySchema = z.object({ candidateId: z.string().min(1).optional() })

/**
 * GET /api/referrals[?candidateId=] — мои рефералы: входящие (ожидают), отправленные.
 * С `candidateId` — только по этому кандидату (баннер в профиле кандидата,
 * docs/tz-discussion-referral.md §2.4); без фильтра — виджет в Лиге.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id
  const query = await getValidatedQuery(event, querySchema.parse)

  const where = [
    eq(referral.organizationId, orgId),
    or(eq(referral.fromUserId, userId), eq(referral.toUserId, userId))!,
  ]
  if (query.candidateId) where.push(eq(referral.candidateId, query.candidateId))

  const rows = await db.query.referral.findMany({
    where: and(...where),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 40,
  })

  const userIds = [...new Set(rows.flatMap(r => [r.fromUserId, r.toUserId]))]
  const candIds = [...new Set(rows.map(r => r.candidateId))]
  const jobIds = [...new Set(rows.map(r => r.suggestedJobId).filter((v): v is string => !!v))]
  const names = new Map<string, string>()
  const cands = new Map<string, string>()
  const jobs = new Map<string, string>()
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
  if (jobIds.length) {
    const jr = await db.execute<{ id: string, title: string }>(sql`
      SELECT id, title FROM job WHERE id IN (${sql.join(jobIds.map(i => sql`${i}`), sql`, `)})
    `)
    for (const j of jr as any[]) jobs.set(j.id, j.title)
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
    suggestedJobId: r.suggestedJobId,
    suggestedJobTitle: r.suggestedJobId ? (jobs.get(r.suggestedJobId) ?? null) : null,
    resultApplicationId: r.resultApplicationId,
    fromApplicationId: r.fromApplicationId,
    note: r.note,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  })

  return {
    incoming: rows.filter(r => r.toUserId === userId && r.status === 'pending').map(map),
    sent: rows.filter(r => r.fromUserId === userId).map(map),
  }
})
