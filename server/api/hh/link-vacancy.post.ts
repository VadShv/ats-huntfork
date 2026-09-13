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
import { jobMember } from '../../database/schema/hm'
import { getHhAccountForUser } from '../../utils/hh/tokens'

/**
 * §J: ensure the linking user is a recruiter on the target job, so incoming
 * hh.ru responses (scoped by application.jobId ∈ job_member(recruiter)) are
 * visible to them. Idempotent; does NOT change an existing primary recruiter
 * (linker becomes an additional recruiter if a primary already exists).
 */
async function ensureLinkerIsRecruiter(orgId: string, jobId: string, userId: string): Promise<void> {
  const [existing] = await db
    .select({ id: jobMember.id })
    .from(jobMember)
    .where(and(
      eq(jobMember.organizationId, orgId),
      eq(jobMember.jobId, jobId),
      eq(jobMember.userId, userId),
      eq(jobMember.memberRole, 'recruiter'),
    ))
    .limit(1)
  if (existing) return
  // Primary only if the job has no primary recruiter yet.
  const [primary] = await db
    .select({ id: jobMember.id })
    .from(jobMember)
    .where(and(
      eq(jobMember.organizationId, orgId),
      eq(jobMember.jobId, jobId),
      eq(jobMember.memberRole, 'recruiter'),
      eq(jobMember.isPrimary, true),
    ))
    .limit(1)
  await db.insert(jobMember).values({
    organizationId: orgId,
    jobId,
    userId,
    memberRole: 'recruiter',
    isPrimary: !primary,
    addedByUserId: userId,
  }).onConflictDoNothing({ target: [jobMember.jobId, jobMember.userId, jobMember.memberRole] })
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
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
    await ensureLinkerIsRecruiter(orgId, jobId, session.user.id)
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

  await ensureLinkerIsRecruiter(orgId, jobId, session.user.id)

  return { id: inserted[0]!.id, created: true }
})
