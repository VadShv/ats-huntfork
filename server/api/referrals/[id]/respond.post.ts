import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { referral } from '../../../database/schema/app'
import {
  createReferralCard, jobTitleOf, placeCandidateOnJob, updateReferralCardStatus, userDisplayName,
} from '../../../utils/referrals/discussion'
import type { ReferralEventPayload } from '../../../../shared/referrals/event'

const paramsSchema = z.object({ id: z.string().min(1) })
const bodySchema = z.object({ accept: z.boolean(), jobId: z.string().min(1).optional() })

/**
 * POST /api/referrals/:id/respond — адресат принимает (кандидат ложится на вакансию,
 * карточка в целевом треде, статус в карточке-источнике) или отклоняет (статус в карточке-источнике).
 * docs/tz-discussion-referral.md §2.4.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  const ref = await db.query.referral.findFirst({ where: and(eq(referral.id, id), eq(referral.organizationId, orgId)) })
  if (!ref) throw createError({ statusCode: 404, statusMessage: 'Реферал не найден' })
  if (ref.toUserId !== userId) throw createError({ statusCode: 403, statusMessage: 'Только получатель может ответить' })
  if (ref.status !== 'pending') throw createError({ statusCode: 409, statusMessage: 'Реферал уже обработан' })

  const now = new Date()
  if (!body.accept) {
    await db.update(referral).set({ status: 'declined', resolvedAt: now }).where(eq(referral.id, id))
    await updateReferralCardStatus(db, ref.sourceCommentId, { status: 'declined', resolvedAt: now })
    return { status: 'declined' }
  }

  const jobId = body.jobId ?? ref.suggestedJobId
  if (!jobId) throw createError({ statusCode: 400, statusMessage: 'Укажите вакансию' })
  const jobTitle = await jobTitleOf(db, orgId, jobId)
  if (!jobTitle) throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })

  const placed = await placeCandidateOnJob(db, { orgId, candidateId: ref.candidateId, jobId, userId })

  const [fromUserName, toUserName] = await Promise.all([userDisplayName(db, ref.fromUserId), userDisplayName(db, ref.toUserId)])
  let targetCommentId: string | null = ref.targetCommentId
  if (placed.applicationId !== ref.fromApplicationId) {
    const payload: ReferralEventPayload = {
      event: 'referral',
      role: 'target',
      referralId: ref.id,
      status: 'accepted',
      fromUserId: ref.fromUserId,
      fromUserName,
      toUserId: ref.toUserId,
      toUserName,
      jobId,
      jobTitle,
      note: ref.note,
      sourceApplicationId: ref.fromApplicationId,
      targetApplicationId: placed.applicationId,
      resolvedAt: now.toISOString(),
    }
    targetCommentId = await createReferralCard(db, {
      orgId, applicationId: placed.applicationId, candidateId: ref.candidateId, authorUserId: userId, payload,
    })
  }

  await db.update(referral)
    .set({ status: 'accepted', resultApplicationId: placed.applicationId, suggestedJobId: jobId, resolvedAt: now, targetCommentId })
    .where(eq(referral.id, id))
  await updateReferralCardStatus(db, ref.sourceCommentId, { status: 'accepted', targetApplicationId: placed.applicationId, resolvedAt: now })

  return { status: 'accepted', applicationId: placed.applicationId }
})
