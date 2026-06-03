/**
 * POST /api/hh/link-vacancy
 *
 * Создаёт связь между только что созданной в Huntfork вакансией (job)
 * и оригинальной вакансией на hh.ru. Связь нужна для фонового импорта
 * откликов (Sprint 3) и для отображения источника в UI.
 *
 * Тело: { jobId: string, hhVacancyId: string, hhVacancyUrl?: string, hhVacancyTitle?: string }
 */
import { and, eq } from 'drizzle-orm'
import { hhVacancyLink, job } from '../../database/schema'
import { getHhAccountForUser } from '../../utils/hh/tokens'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  const body = await readBody<{
    jobId?: string
    hhVacancyId?: string
    hhVacancyUrl?: string
    hhVacancyTitle?: string
  }>(event)

  const jobId = (body?.jobId ?? '').trim()
  const hhVacancyId = (body?.hhVacancyId ?? '').trim()

  if (!jobId || !hhVacancyId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Обязательны поля jobId и hhVacancyId',
    })
  }

  // Проверяем, что вакансия принадлежит текущей организации
  const jobRows = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.organizationId, orgId)))
    .limit(1)
  if (jobRows.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const acc = await getHhAccountForUser(orgId, session.user.id)
  if (!acc || !acc.isActive) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Аккаунт hh.ru не подключён',
    })
  }

  // Если связь для этой пары (org, hhVacancyId) уже существует — обновим её
  const existing = await db
    .select({ id: hhVacancyLink.id })
    .from(hhVacancyLink)
    .where(and(
      eq(hhVacancyLink.organizationId, orgId),
      eq(hhVacancyLink.hhVacancyId, hhVacancyId),
    ))
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(hhVacancyLink)
      .set({
        jobId,
        hhAccountId: acc.id,
        hhVacancyUrl: body?.hhVacancyUrl ?? null,
        hhVacancyTitle: body?.hhVacancyTitle ?? null,
        updatedAt: new Date(),
      })
      .where(eq(hhVacancyLink.id, existing[0]!.id))
    return { id: existing[0]!.id, created: false }
  }

  const inserted = await db
    .insert(hhVacancyLink)
    .values({
      organizationId: orgId,
      jobId,
      hhAccountId: acc.id,
      hhVacancyId,
      hhVacancyUrl: body?.hhVacancyUrl ?? null,
      hhVacancyTitle: body?.hhVacancyTitle ?? null,
      autoSyncEnabled: true,
    })
    .returning({ id: hhVacancyLink.id })

  return { id: inserted[0]!.id, created: true }
})
