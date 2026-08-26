import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { application, job } from '../../../database/schema'
import { idParamSchema } from '../../../utils/schemas/job'

/**
 * GET /api/jobs/:id/scored-count
 *
 * Возвращает количество откликов у вакансии, у которых уже есть AI-скор
 * (application.score IS NOT NULL). Используется UI, чтобы предложить
 * пересчёт после изменения набора критериев скрининга.
 *
 * Returns:
 *   totalApplications — всего откликов у вакансии
 *   scoredApplications — сколько из них уже проскорены
 *   hasScoredApps — true, если есть проскоренные (шорткат для UI-диалога)
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: { id: true },
  })

  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const [totalRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(application)
    .where(and(eq(application.jobId, id), eq(application.organizationId, orgId)))

  const [scoredRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(application)
    .where(
      and(
        eq(application.jobId, id),
        eq(application.organizationId, orgId),
        isNotNull(application.score),
      ),
    )

  const totalApplications = Number(totalRow?.n ?? 0)
  const scoredApplications = Number(scoredRow?.n ?? 0)

  return {
    totalApplications,
    scoredApplications,
    hasScoredApps: scoredApplications > 0,
  }
})
