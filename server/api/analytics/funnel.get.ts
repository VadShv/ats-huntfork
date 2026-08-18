import { sql, eq, and } from 'drizzle-orm'
import { db } from '../../utils/db'
import { pipeline, pipelineStage, job } from '../../database/schema'
import { analyticsQuerySchema, resolvePeriod, mvFilterConditions, andAll } from '../../utils/analytics/filters'
import { analyticsRefreshState } from '../../utils/analytics/refresh-state'

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
  const orderByRootId = new Map(roots.map(r => [r.id, r.displayOrder]))

  // ── Агрегаты mv по root-этапам (в границах воронки) ───────────────────────
  const mvConds = mvFilterConditions('v', orgId, { ...q, pipelineId })
  const { from, to } = period

  const [enteredRows, currentRows, exitRows, durationRows, transitionRows]: any[] = await Promise.all([
    db.execute(sql`
      SELECT v.root_stage_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.entered_at >= ${from}`, sql`v.entered_at < ${to}`])}
      GROUP BY v.root_stage_id
    `),

    // «Сейчас на этапе» — открытые визиты, сверенные с фактическим текущим этапом
    db.execute(sql`
      SELECT v.root_stage_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN application a ON a.id = v.application_id AND a.current_stage_id = v.stage_id
      WHERE ${andAll([...mvConds, sql`v.exited_at IS NULL`])}
      GROUP BY v.root_stage_id
    `),

    // Уходы с этапа за период: суммарно + вперёд + в отказ (по root целевого этапа)
    db.execute(sql`
      SELECT
        v.root_stage_id,
        next_root.id AS next_root_id,
        next_root.bucket AS next_bucket,
        next_root.display_order AS next_order,
        count(*)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
      JOIN pipeline_stage next_root ON next_root.id = COALESCE(next_ps.parent_stage_id, next_ps.id)
      WHERE ${andAll([...mvConds, sql`v.exited_at >= ${from}`, sql`v.exited_at < ${to}`])}
      GROUP BY v.root_stage_id, next_root.id, next_root.bucket, next_root.display_order
    `),

    // Длительность визитов, завершённых за период
    db.execute(sql`
      SELECT
        v.root_stage_id,
        avg(v.duration_hours) AS avg_hours,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY v.duration_hours) AS median_hours,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY v.duration_hours) AS p90_hours
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.exited_at >= ${from}`, sql`v.exited_at < ${to}`, sql`v.duration_hours IS NOT NULL`])}
      GROUP BY v.root_stage_id
    `),

    // Матрица переходов from_root → to_root за период
    db.execute(sql`
      SELECT
        v.root_stage_id AS from_root_id,
        COALESCE(next_ps.parent_stage_id, next_ps.id) AS to_root_id,
        count(*)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
      WHERE ${andAll([...mvConds, sql`v.exited_at >= ${from}`, sql`v.exited_at < ${to}`])}
      GROUP BY v.root_stage_id, COALESCE(next_ps.parent_stage_id, next_ps.id)
    `),
  ])

  const enteredByRoot = new Map<string, number>(enteredRows.map((r: any) => [r.root_stage_id, r.cnt]))
  const currentByRoot = new Map<string, number>(currentRows.map((r: any) => [r.root_stage_id, r.cnt]))
  const durationByRoot = new Map<string, any>(durationRows.map((r: any) => [r.root_stage_id, r]))

  // Уходы: группируем по исходному root
  const exitsByRoot = new Map<string, { total: number, forward: number, rejected: number, backward: number }>()
  for (const r of exitRows) {
    const agg = exitsByRoot.get(r.root_stage_id) ?? { total: 0, forward: 0, rejected: 0, backward: 0 }
    agg.total += r.cnt
    if (r.next_bucket === 'rejected') agg.rejected += r.cnt
    else if ((orderByRootId.get(r.root_stage_id) ?? 0) < r.next_order) agg.forward += r.cnt
    else agg.backward += r.cnt
    exitsByRoot.set(r.root_stage_id, agg)
  }

  const firstEntered = workingRoots.length ? (enteredByRoot.get(workingRoots[0]!.id) ?? 0) : 0

  const stages = workingRoots.map((r) => {
    const exits = exitsByRoot.get(r.id) ?? { total: 0, forward: 0, rejected: 0, backward: 0 }
    const dur = durationByRoot.get(r.id)
    const entered = enteredByRoot.get(r.id) ?? 0
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      type: r.type,
      displayOrder: r.displayOrder,
      slaDays: r.slaDays,
      slaAlertDays: r.slaAlertDays,
      entered,
      current: currentByRoot.get(r.id) ?? 0,
      exitsTotal: exits.total,
      exitsForward: exits.forward,
      exitsRejected: exits.rejected,
      exitsBackward: exits.backward,
      conversionNext: exits.total > 0 ? Math.round((exits.forward / exits.total) * 1000) / 1000 : null,
      conversionFromStart: firstEntered > 0 ? Math.round((entered / firstEntered) * 1000) / 1000 : null,
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
    period: { from: from.toISOString(), to: to.toISOString() },
    refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    stages,
    rejectedRoots: roots.filter(r => r.bucket === 'rejected').map(r => ({ id: r.id, name: r.name, color: r.color })),
    transitions,
  }
})
