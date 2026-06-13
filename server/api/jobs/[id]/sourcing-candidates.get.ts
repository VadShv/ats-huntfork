/**
 * GET /api/jobs/:id/sourcing-candidates
 *
 * Лента кандидатов сорсинга для конкретной вакансии.
 *
 * Query params:
 *   savedSearchId? — фильтр по конкретному поиску
 *   state?         — фильтр одного статуса: new | reviewed | approved | imported | rejected | contacted
 *                    либо «виртуальный» статус 'active' = new + reviewed + approved
 *                    (рабочий список рекрутера: только что найденные, просмотренные и одобренные).
 *   limit?         — default 50, max 200
 *   offset?        — default 0
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { application, candidate, hhSourcingCandidate, job } from '../../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })

const querySchema = z.object({
  savedSearchId: z.string().min(1).optional(),
  state: z.enum(['new', 'reviewed', 'approved', 'imported', 'rejected', 'contacted', 'active']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const q = await getValidatedQuery(event, querySchema.parse)

  // Проверяем владение вакансией
  const jobRow = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!jobRow) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const conditions = [
    eq(hhSourcingCandidate.jobId, jobId),
    eq(hhSourcingCandidate.organizationId, orgId),
  ]
  if (q.savedSearchId) conditions.push(eq(hhSourcingCandidate.savedSearchId, q.savedSearchId))
  if (q.state === 'active') {
    // Активный рабочий список: ещё не импортирован и не отклонён.
    conditions.push(inArray(hhSourcingCandidate.state, ['new', 'reviewed', 'approved']))
  } else if (q.state) {
    conditions.push(eq(hhSourcingCandidate.state, q.state))
  }

  const rows = await db
    .select({
      id: hhSourcingCandidate.id,
      savedSearchId: hhSourcingCandidate.savedSearchId,
      hhResumeId: hhSourcingCandidate.hhResumeId,
      snapshot: hhSourcingCandidate.snapshot,
      score: hhSourcingCandidate.score,
      scoreRationale: hhSourcingCandidate.scoreRationale,
      state: hhSourcingCandidate.state,
      applicationId: hhSourcingCandidate.applicationId,
      reviewNote: hhSourcingCandidate.reviewNote,
      firstSeenAt: hhSourcingCandidate.firstSeenAt,
      lastSeenAt: hhSourcingCandidate.lastSeenAt,
    })
    .from(hhSourcingCandidate)
    .where(and(...conditions))
    .orderBy(desc(hhSourcingCandidate.firstSeenAt))
    .limit(q.limit)
    .offset(q.offset)

  // ─── Sprint 1: existingCandidate ───
  // Для каждого hh-resume_id в выдаче ищем существующего активного кандидата в этой же организации.
  // Имя поля и тип объекта source-нейтральные — в будущем легко расширим на Avito/LinkedIn и т.п.,
  // добавив новые ветки матчинга (по своим external_id) в этот же блок.
  type ExistingCandidate = {
    id: string
    firstName: string
    lastName: string
    /** Тип входной точки последнего приложения: 'hh' | 'hh_sourcing' | 'manual' | 'api' | null */
    lastApplicationSource: string | null
    applicationCount: number
    hasApplicationOnThisJob: boolean
    lastApplicationCreatedAt: Date | null
  }

  const existingByResumeId = new Map<string, ExistingCandidate>()

  const resumeIds = Array.from(
    new Set(rows.map(r => r.hhResumeId).filter((x): x is string => !!x)),
  )

  if (resumeIds.length > 0) {
    // 1) активные кандидаты с такими hh_resume_id в этой организации
    const existingCandidates = await db
      .select({
        id: candidate.id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        hhResumeId: candidate.hhResumeId,
      })
      .from(candidate)
      .where(and(
        eq(candidate.organizationId, orgId),
        eq(candidate.mergeStatus, 'active'),
        inArray(candidate.hhResumeId, resumeIds),
      ))

    if (existingCandidates.length > 0) {
      const candidateIds = existingCandidates.map(c => c.id)

      // 2) все application'ы этих кандидатов в этой организации (нужны count + флаг по текущей вакансии)
      const apps = await db
        .select({
          candidateId: application.candidateId,
          jobId: application.jobId,
          source: application.source,
          createdAt: application.createdAt,
        })
        .from(application)
        .where(and(
          eq(application.organizationId, orgId),
          inArray(application.candidateId, candidateIds),
        ))

      // Группируем application'ы по candidateId
      const appsByCandidate = new Map<string, typeof apps>()
      for (const a of apps) {
        const arr = appsByCandidate.get(a.candidateId) ?? []
        arr.push(a)
        appsByCandidate.set(a.candidateId, arr)
      }

      for (const c of existingCandidates) {
        if (!c.hhResumeId) continue
        const myApps = appsByCandidate.get(c.id) ?? []
        const sortedApps = [...myApps].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        )
        const last = sortedApps[0] ?? null
        existingByResumeId.set(c.hhResumeId, {
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          lastApplicationSource: last?.source ?? null,
          applicationCount: myApps.length,
          hasApplicationOnThisJob: myApps.some(a => a.jobId === jobId),
          lastApplicationCreatedAt: last?.createdAt ?? null,
        })
      }
    }
  }

  const enriched = rows.map(r => ({
    ...r,
    existingCandidate: r.hhResumeId ? (existingByResumeId.get(r.hhResumeId) ?? null) : null,
  }))

  return { candidates: enriched, limit: q.limit, offset: q.offset }
})
