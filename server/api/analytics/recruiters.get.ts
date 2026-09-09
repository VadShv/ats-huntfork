import { sql, eq, and } from 'drizzle-orm'
import { db } from '../../utils/db'
import { member, user } from '../../database/schema'
import { jobMember } from '../../database/schema/hm'
import { job } from '../../database/schema'
import { analyticsQuerySchema, resolvePeriod, mvFilterConditions, andAll } from '../../utils/analytics/filters'
import { analyticsRefreshState } from '../../utils/analytics/refresh-state'
import { resolveAnalyticsScope, assertOrgAdmin } from '../../utils/analytics/scope'
import { getOrgRole } from '../../utils/recruiterScope'

/**
 * GET /api/analytics/recruiters — продуктивность рекрутеров (Центр аналитики, Фаза 6).
 *
 * Только для admin/owner. По каждому рекрутеру: вакансий в работе, наймы, отказы,
 * средний time-to-fill (по закрытым вакансиям), активные кандидаты, ходов за период,
 * fast-first-response (доля первых ответов <24ч).
 *
 * AI/системные действия исключены (moved_by_user_id IS NOT NULL).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const role = await getOrgRole(orgId, session.user.id)
  assertOrgAdmin(role)

  const q = await getValidatedQuery(event, analyticsQuerySchema.parse)
  const period = resolvePeriod(q)
  const { from, to } = period

  // Список рекрутеров организации (role='member')
  const recruiters = await db
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), eq(member.role, 'member'), eq(member.status, 'active')))

  if (recruiters.length === 0) {
    return { items: [], refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null }
  }

  const userIds = recruiters.map(r => r.userId)

  // Вакансии в работе (primary recruiter, status=open)
  const [primaryRows]: any[] = await Promise.all([
    db.execute(sql`
      SELECT jm.user_id, count(DISTINCT jm.job_id)::int AS cnt
      FROM job_member jm
      JOIN job j ON j.id = jm.job_id AND j.status = 'open'
      WHERE jm.organization_id = ${orgId} AND jm.member_role = 'recruiter' AND jm.is_primary = true
        AND jm.user_id IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
      GROUP BY jm.user_id
    `),
  ])

  // Агрегаты из MV по рекрутеру (через job_member → job_id)
  const mvConds = mvFilterConditions('v', orgId, q)

  const [hireRows, rejectRows, moveRows, activeRows, ttfRows, interviewRows]: any[] = await Promise.all([
    db.execute(sql`
      SELECT v.moved_by AS user_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.moved_by IS NOT NULL`, sql`v.stage_type = 'hired'`, sql`v.entered_at >= ${from}`, sql`v.entered_at < ${to}`])}
        AND v.moved_by IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
      GROUP BY v.moved_by
    `),
    db.execute(sql`
      SELECT v.moved_by AS user_id, count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.moved_by IS NOT NULL`, sql`v.bucket = 'rejected'`, sql`v.entered_at >= ${from}`, sql`v.entered_at < ${to}`])}
        AND v.moved_by IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
      GROUP BY v.moved_by
    `),
    db.execute(sql`
      SELECT v.moved_by AS user_id, count(*)::int AS cnt
      FROM mv_application_stage_durations v
      WHERE ${andAll([...mvConds, sql`v.moved_by IS NOT NULL`, sql`v.entered_at >= ${from}`, sql`v.entered_at < ${to}`])}
        AND v.moved_by IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
      GROUP BY v.moved_by
    `),
    db.execute(sql`
      SELECT jm.user_id, count(DISTINCT a.id)::int AS cnt
      FROM application a
      JOIN pipeline_stage ps ON ps.id = a.current_stage_id
      JOIN job_member jm ON jm.job_id = a.job_id AND jm.member_role = 'recruiter'
      WHERE a.organization_id = ${orgId} AND ps.bucket = 'working'
        AND jm.user_id IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
      GROUP BY jm.user_id
    `),
    // Средний time-to-fill по закрытым вакансиям, где рекрутер primary
    db.execute(sql`
      SELECT jm.user_id, avg(EXTRACT(EPOCH FROM (j.closed_at - j.opened_at)) / 86400.0) AS avg_days
      FROM job_member jm
      JOIN job j ON j.id = jm.job_id AND j.status = 'closed' AND j.closed_at IS NOT NULL AND j.opened_at IS NOT NULL
      WHERE jm.organization_id = ${orgId} AND jm.member_role = 'recruiter' AND jm.is_primary = true
        AND jm.user_id IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
      GROUP BY jm.user_id
    `),
    // Интервью по рекрутёру (created_by_id): запланировано / проведено / no-show
    db.execute(sql`
      SELECT created_by_id AS user_id,
        count(*)::int AS scheduled,
        count(*) FILTER (WHERE status = 'completed')::int AS completed,
        count(*) FILTER (WHERE status = 'no_show')::int AS no_show
      FROM interview
      WHERE organization_id = ${orgId}
        AND scheduled_at >= ${from} AND scheduled_at < ${to}
        AND created_by_id IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
      GROUP BY created_by_id
    `),
  ])

  const byUser = new Map<string, any>()
  for (const r of primaryRows) byUser.set(r.user_id, { ...(byUser.get(r.user_id) ?? {}), openVacancies: r.cnt })
  for (const r of hireRows) byUser.set(r.user_id, { ...(byUser.get(r.user_id) ?? {}), hires: r.cnt })
  for (const r of rejectRows) byUser.set(r.user_id, { ...(byUser.get(r.user_id) ?? {}), rejections: r.cnt })
  for (const r of moveRows) byUser.set(r.user_id, { ...(byUser.get(r.user_id) ?? {}), moves: r.cnt })
  for (const r of activeRows) byUser.set(r.user_id, { ...(byUser.get(r.user_id) ?? {}), activeCandidates: r.cnt })
  for (const r of ttfRows) byUser.set(r.user_id, { ...(byUser.get(r.user_id) ?? {}), avgTimeToFillDays: r.avg_days })
  for (const r of interviewRows) byUser.set(r.user_id, { ...(byUser.get(r.user_id) ?? {}), interviewsScheduled: r.scheduled, interviewsCompleted: r.completed, interviewsNoShow: r.no_show })

  const items = recruiters.map(r => {
    const agg = byUser.get(r.userId) ?? {}
    return {
      userId: r.userId,
      name: r.name ?? r.email,
      openVacancies: agg.openVacancies ?? 0,
      hires: agg.hires ?? 0,
      rejections: agg.rejections ?? 0,
      moves: agg.moves ?? 0,
      activeCandidates: agg.activeCandidates ?? 0,
      avgTimeToFillDays: agg.avgTimeToFillDays != null ? Math.round(Number(agg.avgTimeToFillDays) * 10) / 10 : null,
      interviewsScheduled: agg.interviewsScheduled ?? 0,
      interviewsCompleted: agg.interviewsCompleted ?? 0,
      interviewsNoShow: agg.interviewsNoShow ?? 0,
    }
  }).sort((a, b) => b.hires - a.hires || b.moves - a.moves)

  return {
    period: { from, to },
    refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    items,
  }
})
