/**
 * GET /api/conversations/:id/link-options?q= — кандидаты для ручной привязки.
 * Поиск по имени/telegram (ilike), до 10 кандидатов с их откликами.
 */
import { z } from 'zod'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { application, candidate, commsConversation, job } from '../../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })
const querySchema = z.object({ q: z.string().trim().max(200).optional() })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { q } = await getValidatedQuery(event, querySchema.parse)

  const conv = await db.query.commsConversation.findFirst({
    where: and(eq(commsConversation.id, id), eq(commsConversation.organizationId, orgId)),
    columns: { id: true },
  })
  if (!conv) {
    throw createError({ statusCode: 404, statusMessage: 'Диалог не найден' })
  }

  const term = (q ?? '').trim()
  const filters = [eq(application.organizationId, orgId)]
  if (term) {
    const pattern = `%${term}%`
    filters.push(or(
      ilike(candidate.firstName, pattern),
      ilike(candidate.lastName, pattern),
      ilike(candidate.displayName, pattern),
      ilike(candidate.telegram, pattern),
      sql`${candidate.firstName} || ' ' || ${candidate.lastName} ilike ${pattern}`,
    )!)
  }

  const rows = await db.select({
    applicationId: application.id,
    candidateId: candidate.id,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    displayName: candidate.displayName,
    telegram: candidate.telegram,
    jobTitle: job.title,
    createdAt: application.createdAt,
  })
    .from(application)
    .innerJoin(candidate, eq(application.candidateId, candidate.id))
    .innerJoin(job, eq(application.jobId, job.id))
    .where(and(...filters))
    .orderBy(desc(application.createdAt))
    .limit(10)

  return {
    items: rows.map(r => ({
      applicationId: r.applicationId,
      candidateId: r.candidateId,
      candidateName: r.displayName || `${r.firstName} ${r.lastName}`.trim(),
      telegram: r.telegram,
      jobTitle: r.jobTitle,
    })),
  }
})
