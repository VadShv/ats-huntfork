import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { job } from '../../../../database/schema/app'
import { jobMember } from '../../../../database/schema/hm'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
})

const querySchema = z.object({
  memberRole: z.enum(['hiring_manager', 'recruiter', 'watcher', 'assignee']).default('hiring_manager'),
})

/**
 * DELETE /api/jobs/[id]/members/[userId]?memberRole=hiring_manager
 * Снимает назначение пользователя с вакансии.
 * Права: `member:update`.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const actorId = session.user.id

  const { id: jobId, userId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { memberRole } = await getValidatedQuery(event, querySchema.parse)

  // job принадлежит org
  const [ownedJob] = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.organizationId, orgId)))
    .limit(1)
  if (!ownedJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const [removed] = await db
    .delete(jobMember)
    .where(and(
      eq(jobMember.organizationId, orgId),
      eq(jobMember.jobId, jobId),
      eq(jobMember.userId, userId),
      eq(jobMember.memberRole, memberRole),
    ))
    .returning({ id: jobMember.id, isPrimary: jobMember.isPrimary })

  if (!removed) {
    throw createError({ statusCode: 404, statusMessage: 'Назначение не найдено' })
  }

  // Если сняли основного рекрутера — назначаем основным следующего (самого раннего).
  if (memberRole === 'recruiter' && removed.isPrimary) {
    const [next] = await db
      .select({ id: jobMember.id })
      .from(jobMember)
      .where(and(
        eq(jobMember.jobId, jobId),
        eq(jobMember.memberRole, 'recruiter'),
      ))
      .orderBy(jobMember.addedAt)
      .limit(1)
    if (next) {
      await db.update(jobMember).set({ isPrimary: true }).where(eq(jobMember.id, next.id))
    }
  }

  await recordActivity({
    organizationId: orgId,
    actorId,
    action: 'deleted',
    resourceType: 'job_member',
    resourceId: removed.id,
    metadata: { jobId, userId, memberRole },
  })

  return { success: true }
})
