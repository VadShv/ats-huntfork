import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { referral, application, applicationStageHistory, job } from '../../../database/schema'
import { getEntryStageForPipeline } from '../../../utils/pipeline-helpers'

const paramsSchema = z.object({ id: z.string().min(1) })
const bodySchema = z.object({ accept: z.boolean(), jobId: z.string().min(1).optional() })

/**
 * POST /api/referrals/:id/respond — the target recruiter accepts (placing the
 * candidate on one of their vacancies) or declines.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  const ref = await db.query.referral.findFirst({
    where: and(eq(referral.id, id), eq(referral.organizationId, orgId)),
  })
  if (!ref) throw createError({ statusCode: 404, statusMessage: 'Реферал не найден' })
  if (ref.toUserId !== userId) throw createError({ statusCode: 403, statusMessage: 'Только получатель может ответить' })
  if (ref.status !== 'pending') throw createError({ statusCode: 409, statusMessage: 'Реферал уже обработан' })

  if (!body.accept) {
    await db.update(referral).set({ status: 'declined', resolvedAt: new Date() }).where(eq(referral.id, id))
    return { status: 'declined' }
  }

  const jobId = body.jobId ?? ref.suggestedJobId
  if (!jobId) throw createError({ statusCode: 400, statusMessage: 'Укажите вакансию' })

  const targetJob = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true, pipelineId: true },
  })
  if (!targetJob) throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })

  // Reuse existing application if the candidate is already on this job, else create.
  let appId: string
  const existing = await db.query.application.findFirst({
    where: and(eq(application.organizationId, orgId), eq(application.candidateId, ref.candidateId), eq(application.jobId, jobId)),
    columns: { id: true },
  })
  if (existing) {
    appId = existing.id
  } else {
    let entryStageId: string | null = null
    if (targetJob.pipelineId) {
      const entry = await getEntryStageForPipeline(db, targetJob.pipelineId)
      entryStageId = entry?.id ?? null
    }
    const now = new Date()
    const [created] = await db.insert(application).values({
      organizationId: orgId, candidateId: ref.candidateId, jobId, status: 'new',
      source: 'referral', currentStageId: entryStageId, stageChangedAt: entryStageId ? now : null,
    }).returning({ id: application.id })
    appId = created.id
    if (entryStageId) {
      await db.insert(applicationStageHistory).values({
        organizationId: orgId, applicationId: appId, fromStageId: null, toStageId: entryStageId, movedByUserId: userId, movedAt: now,
      })
    }
  }

  await db.update(referral).set({ status: 'accepted', resultApplicationId: appId }).where(eq(referral.id, id))
  return { status: 'accepted', applicationId: appId }
})
