import { sql } from 'drizzle-orm'
import { db } from '../../utils/db'
import { analyticsQuerySchema, resolvePeriod, andAll, trendBucketExpr } from '../../utils/analytics/filters'
import { analyticsRefreshState } from '../../utils/analytics/refresh-state'
import { resolveAnalyticsScope } from '../../utils/analytics/scope'

/**
 * GET /api/analytics/trends — временные ряды KPI (когортная модель, согласовано с Overview/Funnel).
 *
 * Когорта бакета = отклики, СОЗДАННЫЕ в бакете времени (по created_at). Единая ось.
 * По каждому бакету: размер когорты (новые), сколько из неё достигли hired / rejected,
 * медианный Time-to-Hire. Гранулярность ?groupBy=day|week|month (по умолчанию week).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const q = await getValidatedQuery(event, analyticsQuerySchema.parse)
  const period = resolvePeriod(q)
  const groupBy = q.groupBy ?? 'week'

  const scope = await resolveAnalyticsScope(orgId, session.user.id, q.scope)

  // Когорта: отклики, созданные в периоде + фильтры + scope. Бакет — по created_at.
  const cohortConds = [
    sql`a.organization_id = ${orgId}`,
    sql`a.created_at >= ${period.from}`,
    sql`a.created_at < ${period.to}`,
  ]
  if (q.jobId) cohortConds.push(sql`a.job_id = ${q.jobId}`)
  if (q.source) cohortConds.push(sql`a.source = ${q.source}`)
  if (q.pipelineId) cohortConds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.pipeline_id = ${q.pipelineId})`)
  if (q.recruiterId) {
    cohortConds.push(sql`a.job_id IN (SELECT jm.job_id FROM job_member jm WHERE jm.user_id = ${q.recruiterId} AND jm.member_role = 'recruiter')`)
  }
  if (q.departmentId) cohortConds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.department_id = ${q.departmentId})`)
  if (q.companyId) cohortConds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.company_id = ${q.companyId})`)
  const scopeCond = scope.jobIdCondition('a')
  if (scopeCond) cohortConds.push(scopeCond)

  const bucketExpr = trendBucketExpr('a.created_at', groupBy)

  const [newRows, hireRows, rejectRows, tthRows]: any[] = await Promise.all([
    // Новые (размер когорты) по бакету создания
    db.execute(sql`
      SELECT ${bucketExpr} AS bucket, count(*)::int AS cnt
      FROM application a
      WHERE ${andAll(cohortConds)}
      GROUP BY 1 ORDER BY 1
    `),
    // Наймы: из когорты бакета, достигшие hired
    db.execute(sql`
      SELECT ${bucketExpr} AS bucket, count(DISTINCT a.id)::int AS cnt
      FROM application a
      WHERE ${andAll(cohortConds)}
        AND EXISTS (SELECT 1 FROM mv_application_stage_durations v WHERE v.application_id = a.id AND v.stage_type = 'hired')
      GROUP BY 1 ORDER BY 1
    `),
    // Отказы: из когорты бакета, достигшие rejected
    db.execute(sql`
      SELECT ${bucketExpr} AS bucket, count(DISTINCT a.id)::int AS cnt
      FROM application a
      WHERE ${andAll(cohortConds)}
        AND EXISTS (SELECT 1 FROM mv_application_stage_durations v WHERE v.application_id = a.id AND v.bucket = 'rejected')
      GROUP BY 1 ORDER BY 1
    `),
    // Time-to-Hire медиана по бакету создания когорты (hired.entered_at − created_at)
    db.execute(sql`
      SELECT ${bucketExpr} AS bucket,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (h.hired_at - a.created_at)) / 86400.0) AS p50
      FROM application a
      JOIN LATERAL (
        SELECT min(v.entered_at) AS hired_at
        FROM mv_application_stage_durations v
        WHERE v.application_id = a.id AND v.stage_type = 'hired'
      ) h ON h.hired_at IS NOT NULL
      WHERE ${andAll(cohortConds)}
      GROUP BY 1 ORDER BY 1
    `),
  ])

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
