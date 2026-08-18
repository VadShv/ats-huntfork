import { eq, and, sql, count, gte, lte, desc } from 'drizzle-orm'
import { applicationSource, application, trackingLink, job, candidate, pipelineStage } from '../../../database/schema'
import { getOrgStageRollup } from '../../../utils/funnel-rollup'
import { trackingLinkIdSchema, sourceStatsQuerySchema } from '../../../utils/schemas/trackingLink'

/**
 * GET /api/tracking-links/:id/stats
 * Returns detailed analytics for a single tracking link:
 * - Link metadata (name, channel, code, UTM params, click/app counts)
 * - Daily click/application trend
 * - Application status breakdown (funnel)
 * - All attributed applications with candidate + job info
 * - Referrer domain breakdown
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { sourceTracking: ['read'], application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, trackingLinkIdSchema.parse)
  const query = await getValidatedQuery(event, sourceStatsQuerySchema.parse)

  // ─── Fetch the link itself ────────────────
  const link = await db.query.trackingLink.findFirst({
    where: and(eq(trackingLink.id, id), eq(trackingLink.organizationId, orgId)),
  })

  if (!link) {
    throw createError({ statusCode: 404, statusMessage: 'Ссылка отслеживания не найдена' })
  }

  // ─── Scoped job title ─────────────────────
  let jobTitle: string | null = null
  if (link.jobId) {
    const j = await db.query.job.findFirst({
      where: eq(job.id, link.jobId),
      columns: { title: true },
    })
    jobTitle = j?.title ?? null
  }

  // ─── Date conditions ──────────────────────
  const dateConditions = [eq(applicationSource.trackingLinkId, id)]
  if (query.from) {
    dateConditions.push(gte(applicationSource.createdAt, new Date(query.from)))
  }
  if (query.to) {
    dateConditions.push(lte(applicationSource.createdAt, new Date(query.to)))
  }

  const whereClause = and(...dateConditions)

  // ─── Run all analytics queries in parallel ─
  const [
    stageBreakdown,
    dailyTrend,
    attributedApplications,
    referrerDomains,
    totalAttributed,
  ] = await Promise.all([
    // 1. Фаза 1: разбивка по текущему этапу воронки (не по легаси-статусу)
    db
      .select({
        stageId: application.currentStageId,
        count: count().as('count'),
      })
      .from(applicationSource)
      .innerJoin(application, eq(application.id, applicationSource.applicationId))
      .where(whereClause)
      .groupBy(application.currentStageId),

    // 2. Daily trend (applications over time)
    db
      .select({
        date: sql<string>`date_trunc('day', ${applicationSource.createdAt})::date`.as('day'),
        count: count().as('count'),
      })
      .from(applicationSource)
      .innerJoin(application, eq(application.id, applicationSource.applicationId))
      .where(whereClause)
      .groupBy(sql`date_trunc('day', ${applicationSource.createdAt})::date`)
      .orderBy(sql`date_trunc('day', ${applicationSource.createdAt})::date`),

    // 3. All attributed applications with candidate + job info
    db
      .select({
        applicationId: applicationSource.applicationId,
        channel: applicationSource.channel,
        utmSource: applicationSource.utmSource,
        utmMedium: applicationSource.utmMedium,
        utmCampaign: applicationSource.utmCampaign,
        utmTerm: applicationSource.utmTerm,
        utmContent: applicationSource.utmContent,
        referrerDomain: applicationSource.referrerDomain,
        candidateFirstName: candidate.firstName,
        candidateLastName: candidate.lastName,
        candidateEmail: candidate.email,
        jobTitle: job.title,
        jobId: application.jobId,
        status: application.status,
        currentStageId: application.currentStageId,
        currentStageName: pipelineStage.name,
        currentStageColor: pipelineStage.color,
        currentStageBucket: pipelineStage.bucket,
        currentStageType: pipelineStage.type,
        appliedAt: applicationSource.createdAt,
      })
      .from(applicationSource)
      .innerJoin(application, eq(application.id, applicationSource.applicationId))
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .leftJoin(pipelineStage, eq(pipelineStage.id, application.currentStageId))
      .where(whereClause)
      .orderBy(desc(applicationSource.createdAt))
      .limit(100),

    // 4. Referrer domain breakdown
    db
      .select({
        domain: applicationSource.referrerDomain,
        count: count().as('count'),
      })
      .from(applicationSource)
      .innerJoin(application, eq(application.id, applicationSource.applicationId))
      .where(and(
        ...dateConditions,
        sql`${applicationSource.referrerDomain} IS NOT NULL`,
      ))
      .groupBy(applicationSource.referrerDomain)
      .orderBy(sql`count(*) desc`)
      .limit(10),

    // 5. Total attributed count
    db.$count(applicationSource, eq(applicationSource.trackingLinkId, id)),
  ])

  // ─── Фаза 1: воронка по корневым этапам ────
  const { stageToRoot, rootColumns } = await getOrgStageRollup(orgId)
  const countsByRoot: Record<string, number> = {}
  for (const row of stageBreakdown) {
    if (!row.stageId) continue
    const rootId = stageToRoot[row.stageId]
    if (!rootId) continue
    countsByRoot[rootId] = (countsByRoot[rootId] ?? 0) + row.count
  }
  const funnel = rootColumns.map(col => ({ ...col, count: countsByRoot[col.id] ?? 0 }))

  // ─── Conversion rate ──────────────────────
  const cvr = link.clickCount > 0
    ? Math.round((link.applicationCount / link.clickCount) * 100)
    : 0

  return {
    link: {
      id: link.id,
      name: link.name,
      channel: link.channel,
      code: link.code,
      jobId: link.jobId,
      jobTitle,
      utmSource: link.utmSource,
      utmMedium: link.utmMedium,
      utmCampaign: link.utmCampaign,
      utmTerm: link.utmTerm,
      utmContent: link.utmContent,
      clickCount: link.clickCount,
      applicationCount: link.applicationCount,
      isActive: link.isActive,
      createdAt: link.createdAt,
      cvr,
    },
    funnel,
    dailyTrend,
    attributedApplications,
    referrerDomains,
    totalAttributed,
  }
})
