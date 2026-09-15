/**
 * Stats computation for hh.ru integration.
 *
 * Computes funnel metrics (response → consider → interview → offer → hired)
 * and time metrics from imported hh_negotiation records. Snapshots are
 * stored daily for trend charts.
 */
import { and, eq, gte, lte, desc, sql } from 'drizzle-orm'
import { hhNegotiation, hhVacancyLink, hhStatsSnapshot, job } from '../../database/schema'

export interface VacancyStats {
  totalResponses: number
  inConsider: number
  inInterview: number
  inOffer: number
  hired: number
  discarded: number
  avgTimeToResponse: number | null
  avgTimeToInterview: number | null
  avgTimeToOffer: number | null
  avgTimeToHire: number | null
  conversionRate: number
}

const MS_PER_DAY = 1000 * 60 * 60 * 24

function daysBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
}

/**
 * Collect stats for a single vacancy from imported negotiations.
 * Queries the DB (not hh.ru API) — fast, no rate limit concerns.
 */
export async function collectVacancyStats(vacancyLinkId: string): Promise<VacancyStats> {
  const negotiations = await db
    .select({
      hhCollection: hhNegotiation.hhCollection,
      hhCreatedAt: hhNegotiation.hhCreatedAt,
      hhUpdatedAt: hhNegotiation.hhUpdatedAt,
    })
    .from(hhNegotiation)
    .where(eq(hhNegotiation.hhVacancyLinkId, vacancyLinkId))

  const total = negotiations.length
  const byCollection = negotiations.reduce((acc, n) => {
    const c = n.hhCollection ?? 'unknown'
    acc[c] = (acc[c] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const hired = byCollection['hired'] ?? 0
  const discarded = (byCollection['discard_by_employer'] ?? 0) +
    (byCollection['discard_visible_by_opponent'] ?? 0) +
    (byCollection['discard_after_interview'] ?? 0)

  // Time metrics: avg days from hhCreatedAt to hhUpdatedAt for each stage
  const avgTime = (collection: string): number | null => {
    const items = negotiations.filter(n => n.hhCollection === collection)
    if (items.length === 0) return null
    const days = items
      .map(n => daysBetween(n.hhCreatedAt, n.hhUpdatedAt))
      .filter((d): d is number => d !== null)
    if (days.length === 0) return null
    return Math.round(days.reduce((a, b) => a + b, 0) / days.length)
  }

  return {
    totalResponses: total,
    inConsider: byCollection['consider'] ?? 0,
    inInterview: byCollection['interview'] ?? 0,
    inOffer: byCollection['offer'] ?? 0,
    hired,
    discarded,
    avgTimeToResponse: avgTime('consider'),
    avgTimeToInterview: avgTime('interview'),
    avgTimeToOffer: avgTime('offer'),
    avgTimeToHire: avgTime('hired'),
    conversionRate: total > 0 ? Math.round((hired / total) * 100) : 0,
  }
}

/**
 * Collect org-wide stats by aggregating across all linked vacancies.
 */
export async function collectOrgStats(orgId: string): Promise<VacancyStats> {
  const links = await db
    .select({ id: hhVacancyLink.id })
    .from(hhVacancyLink)
    .where(and(eq(hhVacancyLink.organizationId, orgId), eq(hhVacancyLink.autoSyncEnabled, true)))

  const perVacancy = await Promise.all(links.map(l => collectVacancyStats(l.id)))

  const sum = (selector: (s: VacancyStats) => number): number =>
    perVacancy.reduce((acc, s) => acc + selector(s), 0)

  const total = sum(s => s.totalResponses)
  const hired = sum(s => s.hired)

  const avgTime = (selector: (s: VacancyStats) => number | null): number | null => {
    const values = perVacancy.map(selector).filter((v): v is number => v !== null)
    if (values.length === 0) return null
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length)
  }

  return {
    totalResponses: total,
    inConsider: sum(s => s.inConsider),
    inInterview: sum(s => s.inInterview),
    inOffer: sum(s => s.inOffer),
    hired,
    discarded: sum(s => s.discarded),
    avgTimeToResponse: avgTime(s => s.avgTimeToResponse),
    avgTimeToInterview: avgTime(s => s.avgTimeToInterview),
    avgTimeToOffer: avgTime(s => s.avgTimeToOffer),
    avgTimeToHire: avgTime(s => s.avgTimeToHire),
    conversionRate: total > 0 ? Math.round((hired / total) * 100) : 0,
  }
}

/**
 * Snapshot current stats for all vacancies + org-wide → hh_stats_snapshot.
 * Called by Nitro scheduled task daily at 02:00.
 */
export async function snapshotStats(orgId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)

  // Snapshot per vacancy
  const links = await db
    .select({ id: hhVacancyLink.id })
    .from(hhVacancyLink)
    .where(and(eq(hhVacancyLink.organizationId, orgId), eq(hhVacancyLink.autoSyncEnabled, true)))

  for (const link of links) {
    const stats = await collectVacancyStats(link.id)
    await db.insert(hhStatsSnapshot).values({
      organizationId: orgId,
      vacancyLinkId: link.id,
      snapshotType: 'vacancy_daily',
      ...stats,
      snapshotDate: today,
    })
  }

  // Snapshot org-wide
  const orgStats = await collectOrgStats(orgId)
  await db.insert(hhStatsSnapshot).values({
    organizationId: orgId,
    vacancyLinkId: null,
    snapshotType: 'org_daily',
    ...orgStats,
    snapshotDate: today,
  })
}

export interface StatsTrendPoint {
  snapshotDate: string
  totalResponses: number
  hired: number
  conversionRate: number
  avgTimeToHire: number | null
}

/**
 * Get historical trend data from snapshots for charts.
 */
export async function getStatsTrend(args: {
  orgId: string
  vacancyLinkId?: string
  dateFrom: string
  dateTo: string
}): Promise<StatsTrendPoint[]> {
  const conditions = [
    eq(hhStatsSnapshot.organizationId, args.orgId),
    gte(hhStatsSnapshot.snapshotDate, args.dateFrom),
    lte(hhStatsSnapshot.snapshotDate, args.dateTo),
  ]
  if (args.vacancyLinkId) {
    conditions.push(eq(hhStatsSnapshot.vacancyLinkId, args.vacancyLinkId))
  }

  const rows = await db
    .select({
      snapshotDate: hhStatsSnapshot.snapshotDate,
      totalResponses: hhStatsSnapshot.totalResponses,
      hired: hhStatsSnapshot.hired,
      conversionRate: hhStatsSnapshot.conversionRate,
      avgTimeToHire: hhStatsSnapshot.avgTimeToHire,
    })
    .from(hhStatsSnapshot)
    .where(and(...conditions))
    .orderBy(desc(hhStatsSnapshot.snapshotDate))
    .limit(90)

  return rows.map(r => ({
    snapshotDate: r.snapshotDate,
    totalResponses: r.totalResponses,
    hired: r.hired,
    conversionRate: r.conversionRate ?? 0,
    avgTimeToHire: r.avgTimeToHire,
  }))
}
