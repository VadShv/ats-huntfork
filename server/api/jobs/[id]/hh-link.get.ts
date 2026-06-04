/**
 * GET /api/jobs/:id/hh-link
 *
 * Возвращает метаданные связки вакансии с hh.ru, если она существует.
 * Используется в UI для бейджа/панели «связано с hh.ru».
 *
 * Ответ:
 *   { linked: true, link: { id, hhVacancyId, hhVacancyUrl, hhVacancyTitle,
 *                            lastSyncAt, lastSyncStatus, lastSyncError,
 *                            importedCount, autoSyncEnabled } }
 *   либо { linked: false }
 */
import { and, eq } from 'drizzle-orm'
import { hhVacancyLink, job } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const jobId = getRouterParam(event, 'id')
  if (!jobId) {
    throw createError({ statusCode: 400, statusMessage: 'id обязателен' })
  }

  const orgId = session.session.activeOrganizationId

  // Проверяем что вакансия принадлежит организации (защита от подсматривания)
  const jobRows = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.organizationId, orgId)))
    .limit(1)
  if (jobRows.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const rows = await db
    .select({
      id: hhVacancyLink.id,
      hhVacancyId: hhVacancyLink.hhVacancyId,
      hhVacancyUrl: hhVacancyLink.hhVacancyUrl,
      hhVacancyTitle: hhVacancyLink.hhVacancyTitle,
      lastSyncAt: hhVacancyLink.lastSyncAt,
      lastSyncStatus: hhVacancyLink.lastSyncStatus,
      lastSyncError: hhVacancyLink.lastSyncError,
      importedCount: hhVacancyLink.importedCount,
      autoSyncEnabled: hhVacancyLink.autoSyncEnabled,
    })
    .from(hhVacancyLink)
    .where(and(
      eq(hhVacancyLink.jobId, jobId),
      eq(hhVacancyLink.organizationId, orgId),
    ))
    .limit(1)

  if (rows.length === 0) {
    return { linked: false as const }
  }
  return { linked: true as const, link: rows[0] }
})
