import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { analyticsQuerySchema, resolvePeriod, mvFilterConditions, andAll } from '../../../utils/analytics/filters'

const dropoffQuerySchema = analyticsQuerySchema.extend({
  stageId: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

/**
 * GET /api/analytics/funnel/dropoff?stageId= — drill-down отсеянных (Спринт 23, C2).
 *
 * Список откликов, ушедших с указанного root-этапа в отказную ветку за период:
 * кандидат, вакансия, причина (подэтап «Отказа»), кто перевёл, когда. Пагинация.
 */
export default defineEventHandler(async (event) => {
  // sourceTracking:read есть у owner/admin/member, но НЕ у hiring_manager —
  // аналитика подбора недоступна НМ (как и весь /dashboard в UI)
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const q = await getValidatedQuery(event, dropoffQuerySchema.parse)
  const { from, to } = resolvePeriod(q)
  const offset = (q.page - 1) * q.limit

  const conds = [
    ...mvFilterConditions('v', orgId, q),
    sql`v.root_stage_id = ${q.stageId}`,
    sql`next_ps.bucket = 'rejected'`,
    sql`v.exited_at >= ${from}`,
    sql`v.exited_at < ${to}`,
  ]

  const [rows, countRows]: any[] = await Promise.all([
    db.execute(sql`
      SELECT
        v.application_id,
        v.exited_at,
        c.id AS candidate_id,
        c.first_name,
        c.last_name,
        j.id AS job_id,
        j.title AS job_title,
        next_ps.name AS reject_reason,
        u.name AS moved_by_name
      FROM mv_application_stage_durations v
      JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
      JOIN candidate c ON c.id = v.candidate_id
      JOIN job j ON j.id = v.job_id
      LEFT JOIN "user" u ON u.id = v.moved_by
      WHERE ${andAll(conds)}
      ORDER BY v.exited_at DESC
      LIMIT ${q.limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT count(*)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
      WHERE ${andAll(conds)}
    `),
  ])

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    total: countRows[0]?.cnt ?? 0,
    page: q.page,
    limit: q.limit,
    items: rows.map((r: any) => ({
      applicationId: r.application_id,
      candidateId: r.candidate_id,
      candidateFirstName: r.first_name,
      candidateLastName: r.last_name,
      jobId: r.job_id,
      jobTitle: r.job_title,
      rejectReason: r.reject_reason,
      movedByName: r.moved_by_name ?? null,
      exitedAt: r.exited_at,
    })),
  }
})
