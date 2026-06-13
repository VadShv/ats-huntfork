/**
 * GET /api/extension/jobs
 *
 * Список активных вакансий org для дропдауна в расширении.
 * Сортировка: открытые сверху, потом по updated_at desc.
 *
 * Ответ: { jobs: Array<{ id, title, status, hhVacancyId?, applicationsCount }> }
 */
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { application, hhVacancyLink, job } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId

  const jobs = await db
    .select({
      id: job.id,
      title: job.title,
      status: job.status,
      updatedAt: job.updatedAt,
      hhVacancyId: hhVacancyLink.hhVacancyId,
      applicationsCount: sql<number>`(
        SELECT COUNT(*)::int FROM application a
        WHERE a.job_id = ${job.id} AND a.organization_id = ${orgId}
      )`,
    })
    .from(job)
    .leftJoin(
      hhVacancyLink,
      and(eq(hhVacancyLink.jobId, job.id), eq(hhVacancyLink.organizationId, orgId)),
    )
    .where(and(
      eq(job.organizationId, orgId),
      ne(job.status, 'archived'),
    ))
    .orderBy(desc(job.status), desc(job.updatedAt))
    .limit(200)

  return {
    jobs: jobs.map(j => ({
      id: j.id,
      title: j.title,
      status: j.status,
      hhVacancyId: j.hhVacancyId ?? null,
      applicationsCount: j.applicationsCount,
    })),
  }
})
