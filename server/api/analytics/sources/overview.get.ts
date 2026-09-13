import { eq, and, sql, count, gte, lt, desc } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { applicationSource, application, trackingLink, job } from '../../../database/schema'
import { getOrgStageRollup } from '../../../utils/funnel-rollup'
import { analyticsQuerySchema, resolvePeriod } from '../../../utils/analytics/filters'
import { resolveAnalyticsScope } from '../../../utils/analytics/scope'
import { analyticsRefreshState } from '../../../utils/analytics/refresh-state'

/**
 * GET /api/analytics/sources/overview — полная аналитика источников (Блок B, Вариант A).
 *
 * Перенос source-tracking/stats.get.ts под единые фильтры/период/scope центра:
 * channelBreakdown, topLinks (+CTR), source→root-stage воронка, dailyTrend,
 * recentAttributed, referrerDomains, attributionRate.
 *
 * Данные из applicationSource (НЕ из MV) — join к application напрямую.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { sourceTracking: ['read'], application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const q = await getValidatedQuery(event, analyticsQuerySchema.parse)
  const { from, to } = resolvePeriod(q)

  const scope = await resolveAnalyticsScope(orgId, session.user.id, q.scope)
  const scopedJobIds = scope.scoped ? scope.jobIds : null

  // Базовые условия (период + scope + опц. jobId)
  const baseConds = [
    eq(applicationSource.organizationId, orgId),
    gte(applicationSource.createdAt, new Date(from)),
    lt(applicationSource.createdAt, new Date(to)),
  ]
  if (q.jobId) baseConds.push(eq(application.jobId, q.jobId))
  if (scopedJobIds) {
    if (scopedJobIds.length === 0) {
      return emptyResult()
    }
    baseConds.push(sql`${application.jobId} IN (${sql.join(scopedJobIds.map(id => sql`${id}`), sql`, `)})`)
  }
  const whereClause = and(...baseConds)

  const [channelBreakdown, topLinks, stageByChannel, dailyTrend, totalTracked, topReferrerDomains]: any[] = await Promise.all([
    db.select({ channel: applicationSource.channel, count: count().as('count') })
      .from(applicationSource)
      .innerJoin(application, eq(application.id, applicationSource.applicationId))
      .where(whereClause).groupBy(applicationSource.channel).orderBy(sql`count(*) desc`),

    db.select({
      id: trackingLink.id, name: trackingLink.name, channel: trackingLink.channel, code: trackingLink.code,
      jobTitle: job.title, clickCount: trackingLink.clickCount, applicationCount: trackingLink.applicationCount,
      isActive: trackingLink.isActive,
    })
      .from(trackingLink)
      .leftJoin(job, eq(job.id, trackingLink.jobId))
      .where(eq(trackingLink.organizationId, orgId))
      .orderBy(desc(trackingLink.applicationCount)).limit(10),

    db.select({ channel: applicationSource.channel, stageId: application.currentStageId, count: count().as('count') })
      .from(applicationSource)
      .innerJoin(application, eq(application.id, applicationSource.applicationId))
      .where(whereClause).groupBy(applicationSource.channel, application.currentStageId),

    db.select({
      date: sql<string>`date_trunc('day', ${applicationSource.createdAt})::date`.as('day'),
      channel: applicationSource.channel, count: count().as('count'),
    })
      .from(applicationSource)
      .innerJoin(application, eq(application.id, applicationSource.applicationId))
      .where(whereClause)
      .groupBy(sql`date_trunc('day', ${applicationSource.createdAt})::date`, applicationSource.channel)
      .orderBy(sql`date_trunc('day', ${applicationSource.createdAt})::date`),

    db.select({ c: count() }).from(applicationSource)
      .innerJoin(application, eq(application.id, applicationSource.applicationId))
      .where(whereClause).then((r: any) => Number(r[0]?.c ?? 0)),

    db.select({ domain: applicationSource.referrerDomain, count: count().as('count') })
      .from(applicationSource)
      .innerJoin(application, eq(application.id, applicationSource.applicationId))
      .where(and(whereClause, sql`${applicationSource.referrerDomain} IS NOT NULL`))
      .groupBy(applicationSource.referrerDomain).orderBy(sql`count(*) desc`).limit(10),
  ])

  // Untracked (без source) за период
  const untrackedRows: any = await db.execute(sql`
    SELECT count(*)::int AS cnt FROM application a
    WHERE a.organization_id = ${orgId}
      AND a.created_at >= ${from} AND a.created_at < ${to}
      ${q.jobId ? sql`AND a.job_id = ${q.jobId}` : sql``}
      ${scopedJobIds ? sql`AND a.job_id IN (${sql.join(scopedJobIds.map(id => sql`${id}`), sql`, `)})` : sql``}
      AND NOT EXISTS (SELECT 1 FROM application_source s WHERE s.application_id = a.id)
  `)
  const totalUntracked = untrackedRows[0]?.cnt ?? 0

  // Воронка канал → root-этап
  const { stageToRoot, rootColumns } = await getOrgStageRollup(orgId)
  const funnel: Record<string, Record<string, number>> = {}
  for (const row of stageByChannel) {
    if (!row.stageId) continue
    const rootId = stageToRoot[row.stageId]
    if (!rootId) continue
    const entry = (funnel[row.channel] ??= {})
    entry[rootId] = (entry[rootId] ?? 0) + row.count
  }

  return {
    period: { from, to },
    refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    channelBreakdown,
    topLinks: topLinks.map((l: any) => ({ ...l, ctr: l.clickCount > 0 ? Math.round((l.applicationCount / l.clickCount) * 1000) / 1000 : null })),
    funnel,
    funnelStages: rootColumns,
    dailyTrend,
    topReferrerDomains,
    summary: {
      totalTracked, totalUntracked,
      attributionRate: totalTracked + totalUntracked > 0 ? Math.round((totalTracked / (totalTracked + totalUntracked)) * 100) : 0,
    },
  }
})

function emptyResult() {
  return {
    period: null, refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    channelBreakdown: [], topLinks: [], funnel: {}, funnelStages: [], dailyTrend: [],
    topReferrerDomains: [], summary: { totalTracked: 0, totalUntracked: 0, attributionRate: 0 },
  }
}
