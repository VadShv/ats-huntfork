/**
 * GET /api/hh/coverage/gaps
 *
 * List unresolved coverage gaps for the current org.
 */
import { and, eq, isNull, desc } from 'drizzle-orm'
import { hhCoverageGap, hhVacancyLink, job } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhStats: ['read'] })
  const orgId = session.activeOrganizationId

  const query = getQuery(event)
  const vacancyLinkId = query.vacancyLinkId as string | undefined

  const conditions = [
    eq(hhCoverageGap.organizationId, orgId),
    isNull(hhCoverageGap.resolvedAt),
  ]
  if (vacancyLinkId) {
    conditions.push(eq(hhCoverageGap.vacancyLinkId, vacancyLinkId))
  }

  const gaps = await db
    .select({
      gap: hhCoverageGap,
      vacancyTitle: job.title,
      hhVacancyId: hhVacancyLink.hhVacancyId,
    })
    .from(hhCoverageGap)
    .innerJoin(hhVacancyLink, eq(hhCoverageGap.vacancyLinkId, hhVacancyLink.id))
    .innerJoin(job, eq(hhVacancyLink.jobId, job.id))
    .where(and(...conditions))
    .orderBy(desc(hhCoverageGap.detectedAt))
    .limit(200)

  return gaps
})
