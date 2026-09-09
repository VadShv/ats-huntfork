import { sql, eq, and } from 'drizzle-orm'
import { db } from '../../utils/db'
import { pipeline, pipelineStage, job } from '../../database/schema'
import { analyticsQuerySchema, resolvePeriod, mvFilterConditions, andAll } from '../../utils/analytics/filters'
import { analyticsRefreshState } from '../../utils/analytics/refresh-state'
import { resolveAnalyticsScope } from '../../utils/analytics/scope'

/**
 * GET /api/analytics/funnel — воронка по root-этапам (Спринт 23, C2).
 *
 * По каждому root-этапу working-ветки активной воронки:
 *   entered — уникальных откликов вошло за период
 *   current — сейчас на этапе (открытые визиты mv, сверенные с current_stage_id)
 *   exits — покинуло этап за период; forward / rejected — куда ушли
 *   conversionNext = forward / exits (C2: отказ = не прошёл)
 *   conversionFromStart = entered / entered(первый этап)
 *   avg/median duration (часы) — по завершённым визитам периода
 * Плюс матрица переходов from→to по root-этапам (включая ходы назад и отказы).
 *
 * Воронка выбирается: ?pipelineId → воронка вакансии (?jobId) → дефолтная воронка org.
 */
export default defineEventHandler(async (event) => {
  // sourceTracking:read есть у owner/admin/member, но НЕ у hiring_manager —
  // аналитика подбора недоступна НМ (как и весь /dashboard в UI)
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const q = await getValidatedQuery(event, analyticsQuerySchema.parse)
  const period = resolvePeriod(q)

  // Скоуп: member видит только свои вакансии.
  const scope = await resolveAnalyticsScope(orgId, session.user.id)
  const scopeCond = scope.jobIdCondition('v')

  // ── Целевая воронка ────────────────────────────────────────────────────────
  let pipelineId = q.pipelineId ?? null
  if (!pipelineId && q.jobId) {
    const [j] = await db.select({ pipelineId: job.pipelineId })
      .from(job)
      .where(and(eq(job.id, q.jobId), eq(job.organizationId, orgId)))
      .limit(1)
    pipelineId = j?.pipelineId ?? null
  }
  if (!pipelineId) {
    const [def] = await db.select({ id: pipeline.id })
      .from(pipeline)
      .where(and(eq(pipeline.organizationId, orgId), eq(pipeline.isDefault, true)))
      .limit(1)
    pipelineId = def?.id ?? null
  }
  if (!pipelineId) {
    return { pipelineId: null, stages: [], transitions: [], refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null }
  }

  // ── Root-этапы воронки ────────────────────────────────────────────────────
  const roots = await db.select({
    id: pipelineStage.id,
    name: pipelineStage.name,
    color: pipelineStage.color,
    type: pipelineStage.type,
    bucket: pipelineStage.bucket,
    displayOrder: pipelineStage.displayOrder,
    isHidden: pipelineStage.isHidden,
    slaDays: pipelineStage.slaDays,
    slaAlertDays: pipelineStage.slaAlertDays,
  })
    .from(pipelineStage)
    .where(and(
      eq(pipelineStage.pipelineId, pipelineId),
      eq(pipelineStage.organizationId, orgId),
      eq(pipelineStage.isArchived, false),
      sql`${pipelineStage.parentStageId} IS NULL`,
    ))
    .orderBy(pipelineStage.displayOrder)

  const workingRoots = roots.filter(r => r.bucket === 'working' && !r.isHidden)

  // ── Когортная reached-модель ──────────────────────────────────────────────
  // Когорта = отклики, СОЗДАННЫЕ в периоде (application.created_at ∈ [from,to)),
  // в границах воронки + фильтров + scope. reached[X] = сколько из когорты
  // когда-либо имели визит на root-этап X. Конверсии — по людям (DISTINCT),
  // монотонно убывают. current — отдельный snapshot «сейчас» (вне периода).
  const mvConds = mvFilterConditions('v', orgId, { ...q, pipelineId })
  if (scopeCond) mvConds.push(scopeCond)
  const { from, to } = period

  // Условия принадлежности когорте на уровне application (alias 'a').
  // Переиспользуем те же фильтры, но по job_id/source из application.
  const cohortConds = [
    sql`a.organization_id = ${orgId}`,
    sql`a.created_at >= ${from}`,
    sql`a.created_at < ${to}`,
  ]
  if (q.jobId) cohortConds.push(sql`a.job_id = ${q.jobId}`)
  if (q.source) cohortConds.push(sql`a.source = ${q.source}`)
  if (q.recruiterId) {
    cohortConds.push(sql`a.job_id IN (
      SELECT jm.job_id FROM job_member jm
      WHERE jm.user_id = ${q.recruiterId} AND jm.member_role = 'recruiter'
    )`)
  }
  if (q.departmentId) cohortConds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.department_id = ${q.departmentId})`)
  if (q.companyId) cohortConds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.company_id = ${q.companyId})`)
  if (scope.scoped) {
    cohortConds.push(scope.jobIds.length === 0
      ? sql`a.job_id = '__none__'`
      : sql`a.job_id IN (${sql.join(scope.jobIds.map(id => sql`${id}`), sql`, `)})`)
  }
  // Ограничиваем когорту вакансиями целевой воронки (консистентно с pipelineId).
  cohortConds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.pipeline_id = ${pipelineId})`)
  const cohortSQL = sql`SELECT a.id FROM application a WHERE ${andAll(cohortConds)}`

  const [cohortRow, reachedRows, rejectedFromRows, currentRows, durationRows, transitionRows]: any[] = await Promise.all([
    // Размер когорты (знаменатель conversionFromStart)
    db.execute(sql`SELECT count(*)::int AS cnt FROM (${cohortSQL}) c`),

    // reached[root] = откликов когорты, имевших визит на root-этап (working+rejected)
    db.execute(sql`
      SELECT v.root_stage_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE v.application_id IN (${cohortSQL})
      GROUP BY v.root_stage_id
    `),

    // rejectedFromStage[X] = когорта, достигшая X и ушедшая С X в rejected-ветку
    db.execute(sql`
      SELECT v.root_stage_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
      WHERE v.application_id IN (${cohortSQL}) AND next_ps.bucket = 'rejected'
      GROUP BY v.root_stage_id
    `),

    // current — snapshot «сейчас на этапе» (открытые визиты, БЕЗ периода/когорты)
    db.execute(sql`
      SELECT v.root_stage_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN application a ON a.id = v.application_id AND a.current_stage_id = v.stage_id
      WHERE ${andAll([...mvConds, sql`v.exited_at IS NULL`])}
      GROUP BY v.root_stage_id
    `),

    // Длительность визитов когорты (по завершённым визитам на этапе)
    db.execute(sql`
      SELECT
        v.root_stage_id,
        avg(v.duration_hours) AS avg_hours,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY v.duration_hours) AS median_hours,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY v.duration_hours) AS p90_hours
      FROM mv_application_stage_durations v
      WHERE v.application_id IN (${cohortSQL}) AND v.duration_hours IS NOT NULL
      GROUP BY v.root_stage_id
    `),

    // Матрица переходов from_root → to_root среди когорты (для sankey)
    db.execute(sql`
      SELECT
        v.root_stage_id AS from_root_id,
        COALESCE(next_ps.parent_stage_id, next_ps.id) AS to_root_id,
        count(*)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
      WHERE v.application_id IN (${cohortSQL})
      GROUP BY v.root_stage_id, COALESCE(next_ps.parent_stage_id, next_ps.id)
    `),
  ])

  const cohortSize = cohortRow[0]?.cnt ?? 0
  const reachedByRoot = new Map<string, number>(reachedRows.map((r: any) => [r.root_stage_id, r.cnt]))
  const rejectedFromByRoot = new Map<string, number>(rejectedFromRows.map((r: any) => [r.root_stage_id, r.cnt]))
  const currentByRoot = new Map<string, number>(currentRows.map((r: any) => [r.root_stage_id, r.cnt]))
  const durationByRoot = new Map<string, any>(durationRows.map((r: any) => [r.root_stage_id, r]))

  const clamp1 = (v: number) => (v > 1 ? 1 : v)

  const stages = workingRoots.map((r, idx) => {
    const dur = durationByRoot.get(r.id)
    const reached = reachedByRoot.get(r.id) ?? 0
    // Следующий видимый working-root (по порядку) для conversionNext / drop
    const nextRoot = workingRoots[idx + 1]
    const nextReached = nextRoot ? (reachedByRoot.get(nextRoot.id) ?? 0) : null
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      type: r.type,
      displayOrder: r.displayOrder,
      slaDays: r.slaDays,
      slaAlertDays: r.slaAlertDays,
      reached,
      current: currentByRoot.get(r.id) ?? 0,
      // Отвал: достигли X, но не дошли до следующего working-этапа
      drop: nextReached != null ? Math.max(0, reached - nextReached) : null,
      rejectedFromStage: rejectedFromByRoot.get(r.id) ?? 0,
      conversionNext: nextReached != null && reached > 0 ? Math.round(clamp1(nextReached / reached) * 1000) / 1000 : null,
      conversionFromStart: cohortSize > 0 ? Math.round(clamp1(reached / cohortSize) * 1000) / 1000 : null,
      avgHours: dur?.avg_hours != null ? Math.round(Number(dur.avg_hours) * 10) / 10 : null,
      medianHours: dur?.median_hours != null ? Math.round(Number(dur.median_hours) * 10) / 10 : null,
      p90Hours: dur?.p90_hours != null ? Math.round(Number(dur.p90_hours) * 10) / 10 : null,
    }
  })

  // Матрица переходов: имена root-этапов (включая отказные корни)
  const rootNameById = new Map(roots.map(r => [r.id, r.name]))
  const transitions = transitionRows
    .filter((r: any) => rootNameById.has(r.from_root_id) && rootNameById.has(r.to_root_id))
    .map((r: any) => ({
      fromId: r.from_root_id,
      fromName: rootNameById.get(r.from_root_id),
      toId: r.to_root_id,
      toName: rootNameById.get(r.to_root_id),
      count: r.cnt,
    }))

  return {
    pipelineId,
    pipelineScope: q.pipelineId ? 'explicit' : (q.jobId ? 'job' : 'default'),
    cohortSize,
    period: { from, to },
    refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    stages,
    rejectedRoots: roots.filter(r => r.bucket === 'rejected').map(r => ({ id: r.id, name: r.name, color: r.color })),
    transitions,
  }
})
