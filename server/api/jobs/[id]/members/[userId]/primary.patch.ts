import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { job } from '../../../../../database/schema/app'
import { jobMember } from '../../../../../database/schema/hm'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
})

/**
 * PATCH /api/jobs/[id]/members/[userId]/primary
 * Делает указанного рекрутера основным на вакансии (снимает флаг с прежнего).
 * Основной рекрутер используется для персональной статистики «вакансий в работе».
 * Права: `job:update`.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const actorId = session.user.id

  const { id: jobId, userId } = await getValidatedRouterParams(event, paramsSchema.parse)

  // job принадлежит org
  const [ownedJob] = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.organizationId, orgId)))
    .limit(1)
  if (!ownedJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  // target — рекрутер этой вакансии
  const [target] = await db
    .select({ id: jobMember.id })
    .from(jobMember)
    .where(and(
      eq(jobMember.organizationId, orgId),
      eq(jobMember.jobId, jobId),
      eq(jobMember.userId, userId),
      eq(jobMember.memberRole, 'recruiter'),
    ))
    .limit(1)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Рекрутер не назначен на эту вакансию' })
  }

  // Снимаем прежний primary, затем ставим новый (partial unique index не нарушается).
  await db.update(jobMember)
    .set({ isPrimary: false })
    .where(and(
      eq(jobMember.jobId, jobId),
      eq(jobMember.memberRole, 'recruiter'),
      eq(jobMember.isPrimary, true),
    ))
  await db.update(jobMember).set({ isPrimary: true }).where(eq(jobMember.id, target.id))

  await recordActivity({
    organizationId: orgId,
    actorId,
    action: 'updated',
    resourceType: 'job_member',
    resourceId: target.id,
    metadata: { jobId, userId, isPrimary: true },
  })

  return { success: true }
})
