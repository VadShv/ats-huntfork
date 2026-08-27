import { and, count, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { interview, application, candidate, job } from '../../database/schema'
import { interviewQuerySchema } from '../../utils/schemas/interview'
import { resolveRecruiterScope } from '../../utils/recruiterScope'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { interview: ['read'] })
  const orgId = session.session.activeOrganizationId

  const query = await getValidatedQuery(event, interviewQuerySchema.parse)

  // ─── Sprint 20.2: рекрутер (member) видит интервью только по своим вакансиям.
  // Сентинел '__none__' даёт пустую выдачу без ветвления формы ответа (важно для типов useFetch).
  const scope = await resolveRecruiterScope(orgId, session.user.id)

  const conditions = [eq(interview.organizationId, orgId)]
  if (scope.scoped) {
    conditions.push(inArray(application.jobId, scope.jobIds.length > 0 ? scope.jobIds : ['__none__']))
  }

  if (query.applicationId) {
    conditions.push(eq(interview.applicationId, query.applicationId))
  }
  if (query.jobId) {
    conditions.push(eq(application.jobId, query.jobId))
  }
  if (query.status) {
    conditions.push(eq(interview.status, query.status))
  }
  if (query.from) {
    conditions.push(gte(interview.scheduledAt, new Date(query.from)))
  }
  if (query.to) {
    conditions.push(lte(interview.scheduledAt, new Date(query.to)))
  }

  const whereClause = and(...conditions)

  const [data, total] = await Promise.all([
    db
      .select({
        id: interview.id,
        title: interview.title,
        type: interview.type,
        status: interview.status,
        scheduledAt: interview.scheduledAt,
        duration: interview.duration,
        location: interview.location,
        notes: interview.notes,
        interviewers: interview.interviewers,
        invitationSentAt: interview.invitationSentAt,
        candidateResponse: interview.candidateResponse,
        candidateRespondedAt: interview.candidateRespondedAt,
        googleCalendarEventId: interview.googleCalendarEventId,
        googleCalendarEventLink: interview.googleCalendarEventLink,
        createdAt: interview.createdAt,
        updatedAt: interview.updatedAt,
        applicationId: interview.applicationId,
        candidateFirstName: candidate.firstName,
        candidateLastName: candidate.lastName,
        candidateEmail: candidate.email,
        jobId: application.jobId,
        jobTitle: job.title,
      })
      .from(interview)
      .innerJoin(application, eq(application.id, interview.applicationId))
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .where(whereClause)
      .orderBy(desc(interview.scheduledAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit),
    db
      .select({ count: count() })
      .from(interview)
      .innerJoin(application, eq(application.id, interview.applicationId))
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .where(whereClause)
      .then(rows => rows[0]?.count ?? 0),
  ])

  return { data, total, page: query.page, limit: query.limit }
})
