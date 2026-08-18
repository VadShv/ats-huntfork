import { sql } from 'drizzle-orm'
import { db } from '../../utils/db'
import { analyticsQuerySchema, resolvePeriod, mvFilterConditions, andAll, type AnalyticsQuery } from '../../utils/analytics/filters'
import { analyticsRefreshState } from '../../utils/analytics/refresh-state'

/**
 * GET /api/analytics/overview — KPI Обзора (Спринт 23, C2).
 *
 * Отдаёт: активные отклики (сейчас, напрямую из application), новые за период,
 * наймы, отказы, Time-to-Hire p50/p90 (дней), Offer Acceptance;
 * при ?compare=prev — те же метрики за предыдущий период той же длительности.
 *
 * Все периодные метрики читаются из mv_application_stage_durations (не грузим прод),
 * «активные сейчас» — прямой запрос по текущим этапам (now-виджет).
 */
export default defineEventHandler(async (event) => {
  // sourceTracking:read есть у owner/admin/member, но НЕ у hiring_manager —
  // аналитика подбора недоступна НМ (как и весь /dashboard в UI)
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const q = await getValidatedQuery(event, analyticsQuerySchema.parse)
  const period = resolvePeriod(q)

  const [activeNow, current, prev] = await Promise.all([
    countActiveNow(orgId, q),
    periodKpis(orgId, q, period.from, period.to),
    q.compare === 'prev' ? periodKpis(orgId, q, period.prevFrom, period.prevTo) : Promise.resolve(null),
  ])

  return {
    period: { from: period.from, to: period.to },
    prevPeriod: q.compare === 'prev'
      ? { from: period.prevFrom, to: period.prevTo }
      : null,
    refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    kpis: { activeNow, ...current },
    prevKpis: prev,
  }
})

/** Активные отклики сейчас: текущий этап в working-ветке. Прямой запрос (не mv). */
async function countActiveNow(orgId: string, q: AnalyticsQuery): Promise<number> {
  const conds = [sql`a.organization_id = ${orgId}`, sql`ps.bucket = 'working'`]
  if (q.jobId) conds.push(sql`a.job_id = ${q.jobId}`)
  if (q.source) conds.push(sql`a.source = ${q.source}`)
  if (q.pipelineId) conds.push(sql`ps.pipeline_id = ${q.pipelineId}`)
  if (q.recruiterId) {
    conds.push(sql`a.job_id IN (
      SELECT jm.job_id FROM job_member jm
      WHERE jm.user_id = ${q.recruiterId} AND jm.member_role = 'recruiter'
    )`)
  }
  const rows: any = await db.execute(sql`
    SELECT count(*)::int AS cnt
    FROM application a
    JOIN pipeline_stage ps ON ps.id = a.current_stage_id
    WHERE ${andAll(conds)}
  `)
  return rows[0]?.cnt ?? 0
}

interface PeriodKpis {
  newApplications: number
  hires: number
  rejections: number
  timeToHireP50Days: number | null
  timeToHireP90Days: number | null
  offerAcceptance: number | null
}

async function periodKpis(orgId: string, q: AnalyticsQuery, from: string, to: string): Promise<PeriodKpis> {
  const mvConds = mvFilterConditions('v', orgId, q)

  // Новые отклики за период — по application.created_at (прямой запрос по индексу org)
  const newConds = [
    sql`a.organization_id = ${orgId}`,
    sql`a.created_at >= ${from}`,
    sql`a.created_at < ${to}`,
  ]
  if (q.jobId) newConds.push(sql`a.job_id = ${q.jobId}`)
  if (q.source) newConds.push(sql`a.source = ${q.source}`)
  if (q.pipelineId) {
    newConds.push(sql`COALESCE(
      (SELECT ps.pipeline_id FROM pipeline_stage ps WHERE ps.id = a.current_stage_id),
      (SELECT j.pipeline_id FROM job j WHERE j.id = a.job_id)
    ) = ${q.pipelineId}`)
  }
  if (q.recruiterId) {
    newConds.push(sql`a.job_id IN (
      SELECT jm.job_id FROM job_member jm
      WHERE jm.user_id = ${q.recruiterId} AND jm.member_role = 'recruiter'
    )`)
  }

  const [newRows, hireRows, rejectRows, tthRows, offerRows]: any[] = await Promise.all([
    db.execute(sql`SELECT count(*)::int AS cnt FROM application a WHERE ${andAll(newConds)}`),

    // Наймы: входы на этап типа hired за период
    db.execute(sql`
      SELECT count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.stage_type = 'hired'`, sql`v.entered_at >= ${from}`, sql`v.entered_at < ${to}`])}
    `),

    // Отказы: входы в отказную ветку за период (первый вход отклика)
    db.execute(sql`
      SELECT count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.bucket = 'rejected'`, sql`v.entered_at >= ${from}`, sql`v.entered_at < ${to}`])}
    `),

    // Time-to-Hire (C2): hired.entered_at − application.created_at, p50/p90 в днях
    db.execute(sql`
      SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (v.entered_at - a.created_at)) / 86400.0) AS p50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (v.entered_at - a.created_at)) / 86400.0) AS p90
      FROM mv_application_stage_durations v
      JOIN application a ON a.id = v.application_id
      WHERE ${andAll([...mvConds, sql`v.stage_type = 'hired'`, sql`v.entered_at >= ${from}`, sql`v.entered_at < ${to}`])}
    `),

    // Offer Acceptance (C2): наймы / (наймы + уходы с оффера в отказ) за период
    db.execute(sql`
      SELECT count(*)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
      WHERE ${andAll([
        ...mvConds,
        sql`v.stage_type = 'offer'`,
        sql`next_ps.bucket = 'rejected'`,
        sql`v.exited_at >= ${from}`,
        sql`v.exited_at < ${to}`,
      ])}
    `),
  ])

  const hires = hireRows[0]?.cnt ?? 0
  const offerRejects = offerRows[0]?.cnt ?? 0
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
