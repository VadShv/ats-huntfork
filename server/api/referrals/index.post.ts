import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { application, referral } from '../../database/schema/app'
import { requireApplicationInScope } from '../../utils/access/scope'
import {
  createReferralCard, jobTitleOf, notifyReferral, placeCandidateOnJob, userDisplayName,
} from '../../utils/referrals/discussion'
import type { ReferralEventPayload } from '../../../shared/referrals/event'

const bodySchema = z.object({
  candidateId: z.string().min(1),
  toUserId: z.string().min(1),
  suggestedJobId: z.string().min(1).nullable().optional(),
  note: z.string().trim().max(500).optional(),
  /** Отклик, из обсуждения которого передаём (карточка-источник ставится в его ленту). */
  fromApplicationId: z.string().min(1).nullable().optional(),
})

/**
 * POST /api/referrals — передать кандидата коллеге (docs/tz-discussion-referral.md §2).
 *
 * Вакансия выбрана  → кандидат сразу добавляется на неё (отклик source='referral' или существующий),
 *                     реферал accepted, карточки в треде-источнике и в треде целевого отклика.
 * Без вакансии      → реферал pending, карточка только в треде-источнике; вакансию выберет получатель.
 * В обоих случаях адресат получает уведомление типа 'referral'.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const body = await readValidatedBody(event, bodySchema.parse)

  if (body.toUserId === userId) throw createError({ statusCode: 400, statusMessage: 'Нельзя передать самому себе' })

  const member = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM member WHERE organization_id = ${orgId} AND user_id = ${body.toUserId} AND status = 'active'
  `)
  if (Number((member as any[])[0]?.n ?? 0) === 0) throw createError({ statusCode: 404, statusMessage: 'Коллега не найден' })

  const cand = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM candidate WHERE id = ${body.candidateId} AND organization_id = ${orgId}
  `)
  if (Number((cand as any[])[0]?.n ?? 0) === 0) throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })

  let fromApplicationId: string | null = null
  if (body.fromApplicationId) {
    await requireApplicationInScope(event, body.fromApplicationId, orgId)
    const src = await db.query.application.findFirst({
      where: and(eq(application.id, body.fromApplicationId), eq(application.organizationId, orgId), eq(application.candidateId, body.candidateId)),
      columns: { id: true, jobId: true },
    })
    if (!src) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
    if (body.suggestedJobId && src.jobId === body.suggestedJobId) {
      throw createError({ statusCode: 400, statusMessage: 'Кандидат уже на этой вакансии' })
    }
    fromApplicationId = src.id
  }

  const dup = await db.query.referral.findFirst({
    where: and(
      eq(referral.organizationId, orgId),
      eq(referral.candidateId, body.candidateId),
      eq(referral.toUserId, body.toUserId),
      inArray(referral.status, ['pending', 'accepted']),
    ),
    columns: { id: true, status: true, createdAt: true },
  })
  if (dup) throw createError({ statusCode: 409, statusMessage: dup.status === 'pending' ? 'Кандидат уже передан этому коллеге и ждёт ответа' : 'Кандидат уже передан этому коллеге' })

  const suggestedJobId = body.suggestedJobId ?? null
  const jobTitle = await jobTitleOf(db, orgId, suggestedJobId)
  if (suggestedJobId && !jobTitle) throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })

  // Вакансия выбрана — кандидат сразу на ней.
  let targetApplicationId: string | null = null
  if (suggestedJobId) {
    const placed = await placeCandidateOnJob(db, { orgId, candidateId: body.candidateId, jobId: suggestedJobId, userId })
    targetApplicationId = placed.applicationId
  }
  const status = targetApplicationId ? 'accepted' : 'pending'

  const [row] = await db.insert(referral).values({
    organizationId: orgId,
    candidateId: body.candidateId,
    fromUserId: userId,
    toUserId: body.toUserId,
    suggestedJobId,
    note: body.note || null,
    status,
    resultApplicationId: targetApplicationId,
    resolvedAt: targetApplicationId ? new Date() : null,
    fromApplicationId,
  }).returning({ id: referral.id })

  const [fromUserName, toUserName] = await Promise.all([userDisplayName(db, userId), userDisplayName(db, body.toUserId)])
  const base: Omit<ReferralEventPayload, 'role'> = {
    event: 'referral',
    referralId: row!.id,
    status,
    fromUserId: userId,
    fromUserName,
    toUserId: body.toUserId,
    toUserName,
    jobId: suggestedJobId,
    jobTitle,
    note: body.note || null,
    sourceApplicationId: fromApplicationId,
    targetApplicationId,
    resolvedAt: targetApplicationId ? new Date().toISOString() : null,
  }

  let sourceCommentId: string | null = null
  let targetCommentId: string | null = null
  if (fromApplicationId) {
    sourceCommentId = await createReferralCard(db, {
      orgId, applicationId: fromApplicationId, candidateId: body.candidateId, authorUserId: userId, payload: { ...base, role: 'source' },
    })
  }
  if (targetApplicationId && targetApplicationId !== fromApplicationId) {
    targetCommentId = await createReferralCard(db, {
      orgId, applicationId: targetApplicationId, candidateId: body.candidateId, authorUserId: userId, payload: { ...base, role: 'target' },
    })
  }
  if (sourceCommentId || targetCommentId) {
    await db.update(referral).set({ sourceCommentId, targetCommentId }).where(eq(referral.id, row!.id))
  }

  await notifyReferral(db, { orgId, toUserId: body.toUserId, fromUserId: userId, referralId: row!.id, commentId: targetCommentId ?? sourceCommentId })

  return { id: row!.id, status, applicationId: targetApplicationId, sourceCommentId, targetCommentId }
})
