import { and, eq, desc } from 'drizzle-orm'
import { job } from '../../../../database/schema/app'
import { jobMember } from '../../../../database/schema/hm'
import { user } from '../../../../database/schema/auth'
import { idParamSchema } from '../../../../utils/schemas/job'

/**
 * GET /api/jobs/[id]/members
 * Возвращает список назначенных на вакансию людей (в v1 — только НМ).
 * Права: `job:read` (все члены org могут видеть команду вакансии).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)

  // Проверяем принадлежность job к org
  const [ownedJob] = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.organizationId, orgId)))
    .limit(1)

  if (!ownedJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const rows = await db
    .select({
      id: jobMember.id,
      userId: jobMember.userId,
      memberRole: jobMember.memberRole,
      addedAt: jobMember.addedAt,
      addedByUserId: jobMember.addedByUserId,
      userName: user.name,
      userEmail: user.email,
    })
    .from(jobMember)
    .innerJoin(user, eq(user.id, jobMember.userId))
    .where(and(
      eq(jobMember.organizationId, orgId),
      eq(jobMember.jobId, jobId),
    ))
    .orderBy(desc(jobMember.addedAt))

  return { members: rows }
})
