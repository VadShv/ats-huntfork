/**
 * GET /api/hh/coverage/summary
 *
 * Aggregate coverage gaps per vacancy.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { hhCoverageGap, hhVacancyLink, job } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhStats: ['read'] })
  const orgId = session.activeOrganizationId

  const gaps = await db
    .select({
      vacancyLinkId: hhCoverageGap.vacancyLinkId,
      vacancyName: job.title,
      hhVacancyId: hhVacancyLink.hhVacancyId,
      gapCount: sql<number>`count(*)::int`,
      oldestGap: sql<Date>`min(${hhCoverageGap.detectedAt})`,
    })
    .from(hhCoverageGap)
    .innerJoin(hhVacancyLink, eq(hhCoverageGap.vacancyLinkId, hhVacancyLink.id))
    .innerJoin(job, eq(hhVacancyLink.jobId, job.id))
    .where(and(
      eq(hhCoverageGap.organizationId, orgId),
      isNull(hhCoverageGap.resolvedAt),
    ))
    .groupBy(hhCoverageGap.vacancyLinkId, job.title, hhVacancyLink.hhVacancyId)

  const totalGaps = gaps.reduce((sum, g) => sum + g.gapCount, 0)

  return { totalGaps, perVacancy: gaps }
})
