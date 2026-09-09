import { sql } from 'drizzle-orm'
import { db } from '../../utils/db'
import { analyticsQuerySchema, resolvePeriod, mvFilterConditions, andAll, trendBucketExpr } from '../../utils/analytics/filters'
import { analyticsRefreshState } from '../../utils/analytics/refresh-state'
import { resolveAnalyticsScope } from '../../utils/analytics/scope'

/**
 * GET /api/analytics/trends — временные ряды KPI подбора (Центр аналитики, Фаза 3).
 *
 * Гранулярность ?groupBy=day|week|month (по умолчанию week). Считается on-the-fly
 * через date_trunc поверх mv_application_stage_durations (без отдельных rollup-таблиц).
 *
 * Возвращает по каждому бакету времени: новые отклики, наймы, отказы, медианный
 * Time-to-Hire (дни). Ряды строятся по общему набору дат (union), пропуски = 0/null.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const q = await getValidatedQuery(event, analyticsQuerySchema.parse)
  const period = resolvePeriod(q)
  const groupBy = q.groupBy ?? 'week'

  const scope = await resolveAnalyticsScope(orgId, session.user.id)
  const scopeCond = scope.jobIdCondition('v')
  const scopeCondA = scope.jobIdCondition('a')

  const mvConds = mvFilterConditions('v', orgId, q)
  if (scopeCond) mvConds.push(scopeCond)

  const bucketV = trendBucketExpr('v.entered_at', groupBy)

  // Новые отклики — по application.created_at
  const newConds = [
    sql`a.organization_id = ${orgId}`,
    sql`a.created_at >= ${period.from}`,
    sql`a.created_at < ${period.to}`,
  ]
  if (q.jobId) newConds.push(sql`a.job_id = ${q.jobId}`)
  if (q.source) newConds.push(sql`a.source = ${q.source}`)
  if (scopeCondA) newConds.push(scopeCondA)
  const bucketA = trendBucketExpr('a.created_at', groupBy)

  const [newRows, hireRows, rejectRows, tthRows]: any[] = await Promise.all([
    db.execute(sql`
      SELECT ${bucketA} AS bucket, count(*)::int AS cnt
      FROM application a
      WHERE ${andAll(newConds)}
      GROUP BY 1 ORDER BY 1
    `),
    db.execute(sql`
      SELECT ${bucketV} AS bucket, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.stage_type = 'hired'`, sql`v.entered_at >= ${period.from}`, sql`v.entered_at < ${period.to}`])}
      GROUP BY 1 ORDER BY 1
    `),
    db.execute(sql`
      SELECT ${bucketV} AS bucket, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.bucket = 'rejected'`, sql`v.entered_at >= ${period.from}`, sql`v.entered_at < ${period.to}`])}
      GROUP BY 1 ORDER BY 1
    `),
    db.execute(sql`
      SELECT ${bucketV} AS bucket,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (v.entered_at - a.created_at)) / 86400.0) AS p50
      FROM mv_application_stage_durations v
      JOIN application a ON a.id = v.application_id
      WHERE ${andAll([...mvConds, sql`v.stage_type = 'hired'`, sql`v.entered_at >= ${period.from}`, sql`v.entered_at < ${period.to}`])}
      GROUP BY 1 ORDER BY 1
    `),
  ])

  // Собираем ряды по общему набору дат.
  const byBucket = new Map<string, { newApplications: number, hires: number, rejections: number, timeToHireP50Days: number | null }>()
  const ensure = (bucket: string) => {
    let row = byBucket.get(bucket)
    if (!row) {
      row = { newApplications: 0, hires: 0, rejections: 0, timeToHireP50Days: null }
      byBucket.set(bucket, row)
    }
    return row
  }
  const keyOf = (b: any): string => (b instanceof Date ? b.toISOString() : String(b))

  for (const r of newRows) ensure(keyOf(r.bucket)).newApplications = r.cnt ?? 0
  for (const r of hireRows) ensure(keyOf(r.bucket)).hires = r.cnt ?? 0
  for (const r of rejectRows) ensure(keyOf(r.bucket)).rejections = r.cnt ?? 0
  for (const r of tthRows) {
    ensure(keyOf(r.bucket)).timeToHireP50Days = r.p50 != null ? Math.round(Number(r.p50) * 10) / 10 : null
  }

  const points = [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({ bucket, ...v }))

  return {
    period: { from: period.from, to: period.to },
    groupBy,
    refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    points,
  }
})
