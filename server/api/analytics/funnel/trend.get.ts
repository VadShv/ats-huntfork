import { sql, eq, and } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { pipeline, pipelineStage, job } from '../../../database/schema'
import { analyticsQuerySchema, resolvePeriod, andAll, trendBucketExpr } from '../../../utils/analytics/filters'
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

  const scope = await resolveAnalyticsScope(orgId, session.user.id, q.scope)

  const { from, to } = period

  // Когорта бакета = отклики, СОЗДАННЫЕ в бакете времени (по created_at).
  // reached[bucket][root] = сколько из когорты бакета имели визит на root-этап.
  // conversionNext бакета = reached[next]/reached[X] (по людям, ≤100%).
  const bucketA = trendBucketExpr('a.created_at', groupBy)

  // Условия когорты на уровне application (alias 'a')
  const cohortConds = [
    sql`a.organization_id = ${orgId}`,
    sql`a.created_at >= ${from}`,
    sql`a.created_at < ${to}`,
    sql`a.job_id IN (SELECT j.id FROM job j WHERE j.pipeline_id = ${pipelineId})`,
  ]
  if (q.jobId) cohortConds.push(sql`a.job_id = ${q.jobId}`)
  if (q.source) cohortConds.push(sql`a.source = ${q.source}`)
  if (q.recruiterId) {
    cohortConds.push(sql`a.job_id IN (SELECT jm.job_id FROM job_member jm WHERE jm.user_id = ${q.recruiterId} AND jm.member_role = 'recruiter')`)
  }
  if (q.departmentId) cohortConds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.department_id = ${q.departmentId})`)
  if (q.companyId) cohortConds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.company_id = ${q.companyId})`)
  if (scope.scoped) {
    cohortConds.push(scope.jobIds.length === 0
      ? sql`a.job_id = '__none__'`
      : sql`a.job_id IN (${sql.join(scope.jobIds.map(id => sql`${id}`), sql`, `)})`)
  }

  // reached по бакету × root: связываем визиты MV с когортой (её датой создания)
  const reachedRows: any = await db.execute(sql`
    WITH cohort AS (
      SELECT a.id, ${bucketA} AS bucket
      FROM application a
      WHERE ${andAll(cohortConds)}
    )
    SELECT c.bucket, v.root_stage_id, count(DISTINCT v.application_id)::int AS cnt
    FROM cohort c
    JOIN mv_application_stage_durations v ON v.application_id = c.id
    GROUP BY c.bucket, v.root_stage_id
    ORDER BY c.bucket
  `)

  const keyOf = (b: any): string => (b instanceof Date ? b.toISOString() : String(b))

  // byBucket[bucket][rootId] = reached
  const byBucket = new Map<string, Map<string, number>>()
  for (const r of reachedRows) {
    const bk = keyOf(r.bucket)
    let m = byBucket.get(bk)
    if (!m) { m = new Map(); byBucket.set(bk, m) }
    m.set(r.root_stage_id, r.cnt ?? 0)
  }

  const clamp1 = (v: number) => (v > 1 ? 1 : v)
  const points = [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, reachedMap]) => ({
      bucket,
      stages: workingRoots.map((r, idx) => {
        const reached = reachedMap.get(r.id) ?? 0
        const nextRoot = workingRoots[idx + 1]
        const nextReached = nextRoot ? (reachedMap.get(nextRoot.id) ?? 0) : null
        return {
          stageId: r.id,
          stageName: r.name,
          reached,
          conversionNext: nextReached != null && reached > 0
            ? Math.round(clamp1(nextReached / reached) * 1000) / 1000
            : null,
        }
      }),
    }))

  return {
    pipelineId,
    groupBy,
    period: { from, to },
    refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    points,
  }
})
