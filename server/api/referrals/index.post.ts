import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { referral } from '../../database/schema'

const bodySchema = z.object({
  candidateId: z.string().min(1),
  toUserId: z.string().min(1),
  suggestedJobId: z.string().min(1).optional(),
  note: z.string().trim().max(500).optional(),
})

/** POST /api/referrals — refer a candidate to a colleague (status: pending). */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id
  const body = await readValidatedBody(event, bodySchema.parse)

  if (body.toUserId === userId) throw createError({ statusCode: 400, statusMessage: 'Нельзя передать самому себе' })

  // Target must be an org member.
  const member = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM member WHERE organization_id = ${orgId} AND user_id = ${body.toUserId}
  `)
  if (Number((member as any[])[0]?.n ?? 0) === 0) throw createError({ statusCode: 404, statusMessage: 'Коллега не найден' })

  // Candidate must belong to the org.
  const cand = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM candidate WHERE id = ${body.candidateId} AND organization_id = ${orgId}
  `)
  if (Number((cand as any[])[0]?.n ?? 0) === 0) throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })

  // No duplicate active referral for the same candidate → colleague.
  const dup = await db.query.referral.findFirst({
    where: and(
      eq(referral.organizationId, orgId),
      eq(referral.candidateId, body.candidateId),
      eq(referral.toUserId, body.toUserId),
      inArray(referral.status, ['pending', 'accepted']),
    ),
  })
  if (dup) throw createError({ statusCode: 409, statusMessage: 'Такой реферал уже существует' })

  const [row] = await db.insert(referral).values({
    organizationId: orgId,
    candidateId: body.candidateId,
    fromUserId: userId,
    toUserId: body.toUserId,
    suggestedJobId: body.suggestedJobId ?? null,
    note: body.note ?? null,
  }).returning()

  return { id: row.id, status: row.status }
})
