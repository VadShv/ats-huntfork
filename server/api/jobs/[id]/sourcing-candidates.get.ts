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
import { hhSourcingCandidate, job } from '../../../database/schema'

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

  return { candidates: rows, limit: q.limit, offset: q.offset }
})
