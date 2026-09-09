import { sql, eq, and } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { pipeline, pipelineStage, job } from '../../../database/schema'
import { analyticsQuerySchema, resolvePeriod, mvFilterConditions, andAll, trendBucketExpr } from '../../../utils/analytics/filters'
import { analyticsRefreshState } from '../../../utils/analytics/refresh-state'
import { resolveAnalyticsScope } from '../../../utils/analytics/scope'

/**
 * GET /api/analytics/funnel/trend — динамика конверсий воронки во времени (Фаза 4).
 *
 * По каждому бакету времени (groupBy) и root-этапу: entered, exitsForward, exitsRejected.
 * На клиенте из этого строится тренд conversionNext = forward / (forward + rejected + backward).
 *
 * Воронка выбирается каскадом: ?pipelineId → воронка вакансии → дефолтная воронка org.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const q = await getValidatedQuery(event, analyticsQuerySchema.parse)
  const period = resolvePeriod(q)
  const groupBy = q.groupBy ?? 'week'

  // Целевая воронка (каскад)
  let pipelineId = q.pipelineId ?? null
  if (!pipelineId && q.jobId) {
    const [j] = await db.select({ pipelineId: job.pipelineId })
      .from(job).where(and(eq(job.id, q.jobId), eq(job.organizationId, orgId))).limit(1)
    pipelineId = j?.pipelineId ?? null
  }
  if (!pipelineId) {
    const [def] = await db.select({ id: pipeline.id })
      .from(pipeline).where(and(eq(pipeline.organizationId, orgId), eq(pipeline.isDefault, true))).limit(1)
    pipelineId = def?.id ?? null
  }
  if (!pipelineId) {
    return { pipelineId: null, groupBy, points: [], refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null }
  }

  // Root-этапы
  const roots = await db.select({
    id: pipelineStage.id, name: pipelineStage.name, displayOrder: pipelineStage.displayOrder,
    bucket: pipelineStage.bucket, isHidden: pipelineStage.isHidden,
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

  const scope = await resolveAnalyticsScope(orgId, session.user.id)
  const scopeCond = scope.jobIdCondition('v')
  const mvConds = mvFilterConditions('v', orgId, { ...q, pipelineId })
  if (scopeCond) mvConds.push(scopeCond)

  const { from, to } = period
  const bucketV = trendBucketExpr('v.entered_at', groupBy)

  // Вошло и ушло по бакету × root-этапу
  const [enteredRows, exitRows]: any[] = await Promise.all([
    db.execute(sql`
      SELECT ${bucketV} AS bucket, v.root_stage_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.entered_at >= ${from}`, sql`v.entered_at < ${to}`])}
      GROUP BY 1, v.root_stage_id
      ORDER BY 1
    `),
    db.execute(sql`
      SELECT
        ${bucketV} AS bucket,
        v.root_stage_id,
        next_root.id AS next_root_id,
        next_root.bucket AS next_bucket,
        next_root.display_order AS next_order,
        count(*)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
      JOIN pipeline_stage next_root ON next_root.id = COALESCE(next_ps.parent_stage_id, next_ps.id)
      WHERE ${andAll([...mvConds, sql`v.exited_at >= ${from}`, sql`v.exited_at < ${to}`])}
      GROUP BY 1, v.root_stage_id, next_root.id, next_root.bucket, next_root.display_order
      ORDER BY 1
    `),
  ])

  const keyOf = (b: any): string => (b instanceof Date ? b.toISOString() : String(b))

  // Группируем по бакету → этап → { entered, forward, rejected, backward }
  const byBucket = new Map<string, Map<string, { entered: number, forward: number, rejected: number, backward: number }>>()
  const ensureStage = (bucket: string, rootId: string) => {
    let stages = byBucket.get(bucket)
    if (!stages) { stages = new Map(); byBucket.set(bucket, stages) }
    let row = stages.get(rootId)
    if (!row) { row = { entered: 0, forward: 0, rejected: 0, backward: 0 }; stages.set(rootId, row) }
    return row
  }

  for (const r of enteredRows) ensureStage(keyOf(r.bucket), r.root_stage_id).entered += r.cnt ?? 0
  for (const r of exitRows) {
    const row = ensureStage(keyOf(r.bucket), r.root_stage_id)
    if (r.next_bucket === 'rejected') row.rejected += r.cnt
    else if ((orderByRootId.get(r.root_stage_id) ?? 0) < r.next_order) row.forward += r.cnt
    else row.backward += r.cnt
  }

  const rootNameById = new Map(workingRoots.map(r => [r.id, r.name]))
  const points = [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, stages]) => ({
      bucket,
      stages: [...stages.entries()]
        .filter(([id]) => rootNameById.has(id))
        .map(([id, v]) => ({
          stageId: id,
          stageName: rootNameById.get(id),
          entered: v.entered,
          forward: v.forward,
          rejected: v.rejected,
          backward: v.backward,
          conversionNext: (v.forward + v.rejected + v.backward) > 0
            ? Math.round((v.forward / (v.forward + v.rejected + v.backward)) * 1000) / 1000
            : null,
        })),
    }))

  return {
    pipelineId,
    groupBy,
    period: { from, to },
    refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    points,
  }
})
