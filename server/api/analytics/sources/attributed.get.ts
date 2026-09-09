import { z } from 'zod'
import { eq, and, sql, gte, lt, desc } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { applicationSource, application, trackingLink, job, candidate, pipelineStage } from '../../../database/schema'
import { analyticsQuerySchema, resolvePeriod } from '../../../utils/analytics/filters'
import { resolveAnalyticsScope } from '../../../utils/analytics/scope'

const schema = analyticsQuerySchema.extend({
  channel: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

/**
 * GET /api/analytics/sources/attributed — пагинированный список атрибутированных откликов.
 * Вынесен из sources/overview (был лимит 50 без пагинации). Фильтры: период/вакансия/канал/scope.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { sourceTracking: ['read'], application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const q = await getValidatedQuery(event, schema.parse)
  const { from, to } = resolvePeriod(q)
  const offset = (q.page - 1) * q.limit

  const scope = await resolveAnalyticsScope(orgId, session.user.id)
  const conds = [
    eq(applicationSource.organizationId, orgId),
    gte(applicationSource.createdAt, new Date(from)),
    lt(applicationSource.createdAt, new Date(to)),
  ]
  if (q.jobId) conds.push(eq(application.jobId, q.jobId))
  if (q.channel) conds.push(eq(applicationSource.channel, q.channel as any))
  if (scope.scoped) {
    if (scope.jobIds.length === 0) return { total: 0, page: q.page, limit: q.limit, items: [] }
    conds.push(sql`${application.jobId} IN (${sql.join(scope.jobIds.map(id => sql`${id}`), sql`, `)})`)
  }
  const where = and(...conds)

  const [rows, countRows]: any[] = await Promise.all([
    db.select({
      applicationId: applicationSource.applicationId,
      channel: applicationSource.channel,
      utmSource: applicationSource.utmSource,
      referrerDomain: applicationSource.referrerDomain,
      trackingLinkName: trackingLink.name,
      candidateFirstName: candidate.firstName,
      candidateLastName: candidate.lastName,
      jobTitle: job.title,
      stageName: pipelineStage.name,
      appliedAt: applicationSource.createdAt,
    })
      .from(applicationSource)
      .innerJoin(application, eq(application.id, applicationSource.applicationId))
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .leftJoin(trackingLink, eq(trackingLink.id, applicationSource.trackingLinkId))
      .leftJoin(pipelineStage, eq(pipelineStage.id, application.currentStageId))
      .where(where)
      .orderBy(desc(applicationSource.createdAt))
      .limit(q.limit).offset(offset),
    db.select({ c: sql`count(*)::int` })
      .from(applicationSource)
      .innerJoin(application, eq(application.id, applicationSource.applicationId))
      .where(where),
  ])

  return {
    total: Number(countRows[0]?.c ?? 0),
    page: q.page,
    limit: q.limit,
    items: rows.map((r: any) => ({
      applicationId: r.applicationId,
      candidateFirstName: r.candidateFirstName,
      candidateLastName: r.candidateLastName,
      channel: r.channel,
      source: r.trackingLinkName ?? r.utmSource ?? r.referrerDomain ?? null,
      jobTitle: r.jobTitle,
      stageName: r.stageName,
      changedAt: r.appliedAt,
    })),
  }
})
