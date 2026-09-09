import { sql, eq, and, desc } from 'drizzle-orm'
import { db } from '../../utils/db'
import { job, department, company } from '../../database/schema'
import { jobMember } from '../../database/schema/hm'
import { analyticsQuerySchema, resolvePeriod, mvFilterConditions, andAll } from '../../utils/analytics/filters'
import { analyticsRefreshState } from '../../utils/analytics/refresh-state'
import { resolveAnalyticsScope } from '../../utils/analytics/scope'
import { slaP90Cte, stuckCondition } from '../../utils/analytics/sla-threshold'
import { agingBucketIndex, AGING_BUCKET_LABELS, isFullyFilled, computeTimeToFill } from '../../utils/analytics/aggregations'

/**
 * GET /api/analytics/jobs — таблица вакансий с метриками (Центр аналитики, Фаза 5).
 *
 * По каждой вакансии: статус, дней открыта / time-to-fill, активные кандидаты,
 * наймы, отказы, застрявшие (дольше SLA/p90). Скоуп: member → свои вакансии.
 *
 * Сортировка: ?sort=daysOpen|timeToFill|hires|stuck|createdAt (по умолчанию daysOpen desc).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const q = await getValidatedQuery(event, analyticsQuerySchema.parse)
  const period = resolvePeriod(q)
  const sort = getQuery(event).sort as string ?? 'daysOpen'

  const scope = await resolveAnalyticsScope(orgId, session.user.id)

  // Базовые условия выборки вакансий
  const jobConds: any[] = [eq(job.organizationId, orgId)]
  if (q.departmentId) jobConds.push(eq(job.departmentId, q.departmentId))
  if (q.companyId) jobConds.push(eq(job.companyId, q.companyId))
  if (scope.scoped) {
    if (scope.jobIds.length === 0) return { items: [], refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null }
    jobConds.push(sql`${job.id} IN (${sql.join(scope.jobIds.map(id => sql`${id}`), sql`, `)})`)
  }

  // Вакансии с lifecycle-полями + department/company
  const jobs = await db.select({
    id: job.id,
    title: job.title,
    status: job.status,
    departmentId: job.departmentId,
    departmentName: department.name,
    companyName: company.name,
    openedAt: job.openedAt,
    closedAt: job.closedAt,
    firstOpenedAt: job.firstOpenedAt,
    reopenCount: job.reopenCount,
    closeReason: job.closeReason,
    filledAt: job.filledAt,
    headcount: job.headcount,
    createdAt: job.createdAt,
  })
    .from(job)
    .leftJoin(department, eq(department.id, job.departmentId))
    .leftJoin(company, eq(company.id, job.companyId))
    .where(and(...jobConds))
    .orderBy(desc(job.createdAt))
    .limit(200)

  if (jobs.length === 0) {
    return { items: [], refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null }
  }

  // Агрегаты по вакансиям из MV: активные кандидаты, наймы, отказы, застрявшие
  const mvConds = mvFilterConditions('v', orgId, q)
  const scopeCond = scope.jobIdCondition('v')
  if (scopeCond) mvConds.push(scopeCond)

  const [activeRows, hireRows, rejectRows, stuckRows, totalHireRows]: any[] = await Promise.all([
    // Активные кандидаты сейчас (current_stage_id в working)
    db.execute(sql`
      SELECT a.job_id, count(*)::int AS cnt
      FROM application a JOIN pipeline_stage ps ON ps.id = a.current_stage_id
      WHERE a.organization_id = ${orgId} AND ps.bucket = 'working'
        ${scope.scoped ? sql`AND a.job_id IN (${sql.join(scope.jobIds.map(id => sql`${id}`), sql`, `)})` : sql``}
      GROUP BY a.job_id
    `),
    // Наймы за период
    db.execute(sql`
      SELECT v.job_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.stage_type = 'hired'`, sql`v.entered_at >= ${period.from}`, sql`v.entered_at < ${period.to}`])}
      GROUP BY v.job_id
    `),
    // Отказы за период
    db.execute(sql`
      SELECT v.job_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.bucket = 'rejected'`, sql`v.entered_at >= ${period.from}`, sql`v.entered_at < ${period.to}`])}
      GROUP BY v.job_id
    `),
    // Застрявшие: открытый working-визит дольше порога SLA/p90 этапа (C1)
    db.execute(sql`
      WITH ${slaP90Cte(orgId)}
      SELECT v.job_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN application a ON a.id = v.application_id AND a.current_stage_id = v.stage_id
      JOIN pipeline_stage rs ON rs.id = v.root_stage_id
      LEFT JOIN p90_by_root p ON p.root_stage_id = v.root_stage_id
      WHERE ${andAll([...mvConds, stuckCondition('v')])}
      GROUP BY v.job_id
    `),
    // Всего наймов за всё время (для «закрыто N из M») + момент последнего найма
    db.execute(sql`
      SELECT v.job_id, count(DISTINCT v.application_id)::int AS cnt, max(v.entered_at) AS last_hired_at
      FROM mv_application_stage_durations v
      WHERE v.organization_id = ${orgId} AND v.stage_type = 'hired'
      GROUP BY v.job_id
    `),
  ])

  const byJob = new Map<string, any>()
  for (const r of activeRows) byJob.set(r.job_id, { ...(byJob.get(r.job_id) ?? {}), active: r.cnt })
  for (const r of hireRows) byJob.set(r.job_id, { ...(byJob.get(r.job_id) ?? {}), hires: r.cnt })
  for (const r of rejectRows) byJob.set(r.job_id, { ...(byJob.get(r.job_id) ?? {}), rejections: r.cnt })
  for (const r of stuckRows) byJob.set(r.job_id, { ...(byJob.get(r.job_id) ?? {}), stuck: r.cnt })
  for (const r of totalHireRows) byJob.set(r.job_id, { ...(byJob.get(r.job_id) ?? {}), totalHires: r.cnt, lastHiredAt: r.last_hired_at })

  const now = Date.now()
  const items = jobs.map(j => {
    const agg = byJob.get(j.id) ?? {}
    const openedAt = j.openedAt ?? j.firstOpenedAt ?? j.createdAt
    const daysOpen = j.status === 'open'
      ? Math.round((now - openedAt.getTime()) / 86400000)
      : null
    // Единый time-to-fill (headcount-aware) — общий хелпер (#7).
    const totalHires = agg.totalHires ?? 0
    const lastHiredAt = agg.lastHiredAt ? new Date(agg.lastHiredAt) : null
    const timeToFill = computeTimeToFill({
      openedAt, closedAt: j.closedAt, lastHiredAt,
      headcount: j.headcount, status: j.status, totalHires,
    })
    return {
      id: j.id,
      title: j.title,
      status: j.status,
      departmentName: j.departmentName,
      companyName: j.companyName,
      reopenCount: j.reopenCount,
      closeReason: j.closeReason,
      daysOpen,
      timeToFill,
      activeCandidates: agg.active ?? 0,
      hires: agg.hires ?? 0,
      rejections: agg.rejections ?? 0,
      stuck: agg.stuck ?? 0,
      headcount: j.headcount,
      totalHires: agg.totalHires ?? 0,
      fullyFilled: isFullyFilled(agg.totalHires ?? 0, j.headcount),
      openedAt: j.openedAt?.toISOString() ?? null,
      closedAt: j.closedAt?.toISOString() ?? null,
      createdAt: j.createdAt.toISOString(),
    }
  })

  // Сортировка
  const sortKey = sort === 'timeToFill' ? 'timeToFill'
    : sort === 'hires' ? 'hires'
    : sort === 'stuck' ? 'stuck'
    : sort === 'createdAt' ? 'createdAt'
    : 'daysOpen'
  items.sort((a, b) => {
    const av = a[sortKey] as any
    const bv = b[sortKey] as any
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return bv - av
  })

  // ── Aging matrix: распределение по бакетам дней × статус (для heatmap) ──
  // Учитывает период: строка 0 = открытые сейчас (по «дней открыта»);
  // строка 1 = закрытые ИМЕННО в выбранном периоде (closedAt ∈ [from, to)).
  // matrix[statusRow][bucketCol] = count
  const periodFromMs = new Date(period.from).getTime()
  const periodToMs = new Date(period.to).getTime()
  const agingMatrix: number[][] = [Array(5).fill(0), Array(5).fill(0)]
  for (const it of items) {
    if (it.status === 'open' && it.daysOpen != null) {
      agingMatrix[0]![agingBucketIndex(it.daysOpen)]!++
    } else if (it.status === 'closed' && it.timeToFill != null && it.closedAt) {
      const closedMs = new Date(it.closedAt).getTime()
      if (closedMs >= periodFromMs && closedMs < periodToMs) {
        agingMatrix[1]![agingBucketIndex(it.timeToFill)]!++
      }
    }
  }

  return {
    period: { from: period.from, to: period.to },
    refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    items,
    aging: { bucketLabels: AGING_BUCKET_LABELS, rowLabels: ['Открытые (дней открыта)', 'Закрытые в периоде (срок закрытия)'], matrix: agingMatrix },
  }
})
