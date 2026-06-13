/**
 * GET /api/jobs/:id/sourcing-searches
 *
 * Список сохранённых поисковых запросов hh.ru для конкретной вакансии.
 * Поддержка ленты автосорсинга (Joon-like) — пользователь видит
 * все свои настроенные поиски, их статус, расписание и число найденных.
 */
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hhSavedSearch, job } from '../../../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, paramsSchema.parse)

  // Проверка владения вакансией
  const jobRow = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!jobRow) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const searches = await db
    .select({
      id: hhSavedSearch.id,
      name: hhSavedSearch.name,
      query: hhSavedSearch.query,
      sourceUrl: hhSavedSearch.sourceUrl,
      scheduleMinutes: hhSavedSearch.scheduleMinutes,
      autoRunEnabled: hhSavedSearch.autoRunEnabled,
      maxPagesPerRun: hhSavedSearch.maxPagesPerRun,
      maxCandidates: hhSavedSearch.maxCandidates,
      lastRunAt: hhSavedSearch.lastRunAt,
      lastRunStatus: hhSavedSearch.lastRunStatus,
      lastRunError: hhSavedSearch.lastRunError,
      lastRunFound: hhSavedSearch.lastRunFound,
      lastRunNew: hhSavedSearch.lastRunNew,
      nextRunAt: hhSavedSearch.nextRunAt,
      isArchived: hhSavedSearch.isArchived,
      createdAt: hhSavedSearch.createdAt,
      updatedAt: hhSavedSearch.updatedAt,
    })
    .from(hhSavedSearch)
    .where(and(
      eq(hhSavedSearch.jobId, jobId),
      eq(hhSavedSearch.organizationId, orgId),
      eq(hhSavedSearch.isArchived, false),
    ))
    .orderBy(desc(hhSavedSearch.createdAt))

  return { searches }
})
