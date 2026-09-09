import { sql, eq, and } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { job, pipeline, pipelineStage, application, candidate, department, company } from '../../../database/schema'
import { resolvePeriod, mvFilterConditions, andAll } from '../../../utils/analytics/filters'
import { analyticsRefreshState } from '../../../utils/analytics/refresh-state'
import { resolveAnalyticsScope } from '../../../utils/analytics/scope'
import { idParamSchema } from '../../../utils/schemas/job'

/**
 * GET /api/analytics/jobs/:id — метрики и воронка одной вакансии (Фаза 5, доработка).
 *
 * Возвращает: lifecycle-поля, KPI (active/hires/rejections/stuck), funnel stages
 * (entered/current/conversions/durations), transitions (для sankey).
 * Скоуп: member видит только свои вакансии.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const scope = await resolveAnalyticsScope(orgId, session.user.id)
  if (scope.scoped && !scope.jobIds.includes(id)) {
    throw createError({ statusCode: 403, statusMessage: 'Вакансия не в вашем скоупе' })
  }

  // Данные вакансии
  const [j] = await db.select({
    id: job.id, title: job.title, status: job.status,
    departmentName: department.name, companyName: company.name,
    openedAt: job.openedAt, closedAt: job.closedAt, firstOpenedAt: job.firstOpenedAt,
    reopenCount: job.reopenCount, closeReason: job.closeReason, filledAt: job.filledAt,
    headcount: job.headcount, createdAt: job.createdAt, pipelineId: job.pipelineId,
  })
    .from(job)
    .leftJoin(department, eq(department.id, job.departmentId))
    .leftJoin(company, eq(company.id, job.companyId))
    .where(and(eq(job.id, id), eq(job.organizationId, orgId)))
    .limit(1)

  if (!j) throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })

  const period = resolvePeriod({})
  const { from, to } = period

  // Pipeline вакансии
  let pipelineId = j.pipelineId
  if (!pipelineId) {
    const [def] = await db.select({ id: pipeline.id }).from(pipeline)
      .where(and(eq(pipeline.organizationId, orgId), eq(pipeline.isDefault, true))).limit(1)
    pipelineId = def?.id ?? null
  }

  // Root-этапы
  const roots = pipelineId ? await db.select({
    id: pipelineStage.id, name: pipelineStage.name, color: pipelineStage.color,
    type: pipelineStage.type, bucket: pipelineStage.bucket,
    displayOrder: pipelineStage.displayOrder, isHidden: pipelineStage.isHidden,
  })
    .from(pipelineStage)
    .where(and(
      eq(pipelineStage.pipelineId, pipelineId),
      eq(pipelineStage.organizationId, orgId),
      eq(pipelineStage.isArchived, false),
      sql`${pipelineStage.parentStageId} IS NULL`,
    ))
    .orderBy(pipelineStage.displayOrder) : []

  const workingRoots = roots.filter(r => r.bucket === 'working' && !r.isHidden)
  const orderByRootId = new Map(roots.map(r => [r.id, r.displayOrder]))

  // MV-агрегаты с фиксированным jobId
  const mvConds = mvFilterConditions('v', orgId, { jobId: id, pipelineId: pipelineId ?? undefined })

  const [enteredRows, currentRows, exitRows, durationRows, transitionRows, activeCount]: any[] = await Promise.all([
    db.execute(sql`
      SELECT v.root_stage_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.entered_at >= ${from}`, sql`v.entered_at < ${to}`])}
      GROUP BY v.root_stage_id
    `),
    db.execute(sql`
      SELECT v.root_stage_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN application a ON a.id = v.application_id AND a.current_stage_id = v.stage_id
      WHERE ${andAll([...mvConds, sql`v.exited_at IS NULL`])}
      GROUP BY v.root_stage_id
    `),
    db.execute(sql`
      SELECT v.root_stage_id, next_root.id AS next_root_id, next_root.bucket AS next_bucket,
        next_root.display_order AS next_order, count(*)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
      JOIN pipeline_stage next_root ON next_root.id = COALESCE(next_ps.parent_stage_id, next_ps.id)
      WHERE ${andAll([...mvConds, sql`v.exited_at >= ${from}`, sql`v.exited_at < ${to}`])}
      GROUP BY v.root_stage_id, next_root.id, next_root.bucket, next_root.display_order
    `),
    db.execute(sql`
      SELECT v.root_stage_id, avg(v.duration_hours) AS avg_hours,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY v.duration_hours) AS median_hours,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY v.duration_hours) AS p90_hours
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.exited_at >= ${from}`, sql`v.exited_at < ${to}`, sql`v.duration_hours IS NOT NULL`])}
      GROUP BY v.root_stage_id
    `),
    db.execute(sql`
      SELECT v.root_stage_id AS from_root_id,
        COALESCE(next_ps.parent_stage_id, next_ps.id) AS to_root_id, count(*)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
      WHERE ${andAll([...mvConds, sql`v.exited_at >= ${from}`, sql`v.exited_at < ${to}`])}
      GROUP BY v.root_stage_id, COALESCE(next_ps.parent_stage_id, next_ps.id)
    `),
    // Активные сейчас
    db.execute(sql`
      SELECT count(*)::int AS cnt FROM application a
      JOIN pipeline_stage ps ON ps.id = a.current_stage_id
      WHERE a.organization_id = ${orgId} AND a.job_id = ${id} AND ps.bucket = 'working'
    `),
  ])

  const enteredByRoot = new Map(enteredRows.map((r: any) => [r.root_stage_id, r.cnt]))
  const currentByRoot = new Map(currentRows.map((r: any) => [r.root_stage_id, r.cnt]))
  const durationByRoot = new Map(durationRows.map((r: any) => [r.root_stage_id, r]))

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
  const rootNameById = new Map(roots.map(r => [r.id, r.name]))

  const stages = workingRoots.map(r => {
    const exits = exitsByRoot.get(r.id) ?? { total: 0, forward: 0, rejected: 0, backward: 0 }
    const dur = durationByRoot.get(r.id)
    const entered = enteredByRoot.get(r.id) ?? 0
    return {
      id: r.id, name: r.name, color: r.color, type: r.type, displayOrder: r.displayOrder,
      entered, current: currentByRoot.get(r.id) ?? 0,
      exitsTotal: exits.total, exitsForward: exits.forward, exitsRejected: exits.rejected, exitsBackward: exits.backward,
      conversionNext: exits.total > 0 ? Math.round((exits.forward / exits.total) * 1000) / 1000 : null,
      conversionFromStart: firstEntered > 0 ? Math.round((entered / firstEntered) * 1000) / 1000 : null,
      avgHours: dur?.avg_hours != null ? Math.round(Number(dur.avg_hours) * 10) / 10 : null,
      medianHours: dur?.median_hours != null ? Math.round(Number(dur.median_hours) * 10) / 10 : null,
      p90Hours: dur?.p90_hours != null ? Math.round(Number(dur.p90_hours) * 10) / 10 : null,
    }
  })

  const transitions = transitionRows
    .filter((r: any) => rootNameById.has(r.from_root_id) && rootNameById.has(r.to_root_id))
    .map((r: any) => ({
      fromName: rootNameById.get(r.from_root_id), toName: rootNameById.get(r.to_root_id), count: r.cnt,
    }))

  const now = Date.now()
  const openedAt = j.openedAt ?? j.firstOpenedAt ?? j.createdAt
  const daysOpen = j.status === 'open' ? Math.round((now - openedAt.getTime()) / 86400000) : null
  const timeToFill = j.status === 'closed' && j.closedAt ? Math.round((j.closedAt.getTime() - openedAt.getTime()) / 86400000) : null

  return {
    refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    job: {
      id: j.id, title: j.title, status: j.status,
      departmentName: j.departmentName, companyName: j.companyName,
      openedAt: j.openedAt?.toISOString() ?? null, closedAt: j.closedAt?.toISOString() ?? null,
      reopenCount: j.reopenCount, closeReason: j.closeReason, headcount: j.headcount,
      daysOpen, timeToFill, activeCandidates: activeCount[0]?.cnt ?? 0,
    },
    stages,
    transitions,
  }
})
