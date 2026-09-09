import { sql } from 'drizzle-orm'
import { db } from '../../utils/db'
import { analyticsQuerySchema, resolvePeriod, andAll, type AnalyticsQuery } from '../../utils/analytics/filters'
import { analyticsRefreshState } from '../../utils/analytics/refresh-state'
import { resolveAnalyticsScope, type AnalyticsScope } from '../../utils/analytics/scope'
import { countActiveNow } from '../../utils/analytics/active-now'

/**
 * GET /api/analytics/overview — KPI Обзора (когортная модель, согласовано с Funnel).
 *
 * Когорта = отклики, СОЗДАННЫЕ в периоде (application.created_at ∈ [from,to)).
 * hires/rejections = сколько из когорты достигли hired / rejected-ветки (reached-DISTINCT).
 * Time-to-Hire = hired.entered_at − created_at по когорте. offerAcceptance — тоже по когорте.
 * «Активные сейчас» — snapshot (countActiveNow, единый хелпер, вне периода).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const q = await getValidatedQuery(event, analyticsQuerySchema.parse)
  const period = resolvePeriod(q)

  const scope = await resolveAnalyticsScope(orgId, session.user.id)

  const [activeNow, current, prev] = await Promise.all([
    countActiveNow(orgId, q, scope),
    periodKpis(orgId, q, period.from, period.to, scope),
    q.compare === 'prev' ? periodKpis(orgId, q, period.prevFrom, period.prevTo, scope) : Promise.resolve(null),
  ])

  return {
    period: { from: period.from, to: period.to },
    prevPeriod: q.compare === 'prev' ? { from: period.prevFrom, to: period.prevTo } : null,
    refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    kpis: { activeNow, ...current },
    prevKpis: prev,
  }
})

interface PeriodKpis {
  newApplications: number
  hires: number
  rejections: number
  timeToHireP50Days: number | null
  timeToHireP90Days: number | null
  offerAcceptance: number | null
}

async function periodKpis(orgId: string, q: AnalyticsQuery, from: string, to: string, scope: AnalyticsScope): Promise<PeriodKpis> {
  // Когорта: отклики, созданные в периоде + фильтры + scope.
  const cohortConds = [
    sql`a.organization_id = ${orgId}`,
    sql`a.created_at >= ${from}`,
    sql`a.created_at < ${to}`,
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
  const cohortSQL = sql`SELECT a.id FROM application a WHERE ${andAll(cohortConds)}`

  const [newRows, hireRows, rejectRows, tthRows, offerRejRows]: any[] = await Promise.all([
    // Размер когорты (новые отклики за период)
    db.execute(sql`SELECT count(*)::int AS cnt FROM (${cohortSQL}) c`),

    // Наймы: из когорты, достигшие hired (reached-DISTINCT)
    db.execute(sql`
      SELECT count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE v.application_id IN (${cohortSQL}) AND v.stage_type = 'hired'
    `),

    // Отказы: из когорты, достигшие rejected-ветки
    db.execute(sql`
      SELECT count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE v.application_id IN (${cohortSQL}) AND v.bucket = 'rejected'
    `),

    // Time-to-Hire: hired.entered_at − application.created_at по когорте
    db.execute(sql`
      SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (v.entered_at - a.created_at)) / 86400.0) AS p50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (v.entered_at - a.created_at)) / 86400.0) AS p90
      FROM mv_application_stage_durations v
      JOIN application a ON a.id = v.application_id
      WHERE v.application_id IN (${cohortSQL}) AND v.stage_type = 'hired'
    `),

    // Offer Acceptance: из когорты, ушедшие с оффера в отказ (знаменатель вместе с hires)
    db.execute(sql`
      SELECT count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
      WHERE v.application_id IN (${cohortSQL}) AND v.stage_type = 'offer' AND next_ps.bucket = 'rejected'
    `),
  ])

  const hires = hireRows[0]?.cnt ?? 0
  const offerRejects = offerRejRows[0]?.cnt ?? 0
  const offerDecisions = hires + offerRejects

  return {
    newApplications: newRows[0]?.cnt ?? 0,
    hires,
    rejections: rejectRows[0]?.cnt ?? 0,
    timeToHireP50Days: tthRows[0]?.p50 != null ? Math.round(Number(tthRows[0].p50) * 10) / 10 : null,
    timeToHireP90Days: tthRows[0]?.p90 != null ? Math.round(Number(tthRows[0].p90) * 10) / 10 : null,
    offerAcceptance: offerDecisions > 0 ? Math.round((hires / offerDecisions) * 1000) / 1000 : null,
  }
}
