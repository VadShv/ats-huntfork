import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../../../../utils/db'
import { analyticsQuerySchema, resolvePeriod } from '../../../../utils/analytics/filters'
import { getOrgRole } from '../../../../utils/recruiterScope'
import { assertOrgAdmin } from '../../../../utils/analytics/scope'

const schema = analyticsQuerySchema.extend({
  metric: z.enum(['hires', 'moves', 'rejections']).default('moves'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

/**
 * GET /api/analytics/recruiters/:userId/candidates?metric= — drill-down действий рекрутера.
 * Только admin/owner. metric: moves (все ходы) | hires | rejections за период.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = getRouterParam(event, 'userId')!

  const role = await getOrgRole(orgId, session.user.id)
  assertOrgAdmin(role)

  const q = await getValidatedQuery(event, schema.parse)
  const { from, to } = resolvePeriod(q)
  const offset = (q.page - 1) * q.limit

  const typeCond = q.metric === 'hires' ? sql`AND v.stage_type = 'hired'`
    : q.metric === 'rejections' ? sql`AND v.bucket = 'rejected'` : sql``
  const cond = sql`v.organization_id = ${orgId} AND v.moved_by = ${userId} AND v.entered_at >= ${from} AND v.entered_at < ${to} ${typeCond}`

  const [rows, countRows]: any[] = await Promise.all([
    db.execute(sql`
      SELECT DISTINCT ON (v.application_id) v.application_id, c.id AS candidate_id, c.first_name, c.last_name,
        ps.name AS stage_name, j.title AS job_title, v.entered_at AS changed_at
      FROM mv_application_stage_durations v
      JOIN pipeline_stage ps ON ps.id = v.stage_id
      JOIN candidate c ON c.id = v.candidate_id
      JOIN job j ON j.id = v.job_id
      WHERE ${cond} ORDER BY v.application_id, v.entered_at DESC LIMIT ${q.limit} OFFSET ${offset}
    `),
    db.execute(sql`SELECT count(DISTINCT v.application_id)::int AS cnt FROM mv_application_stage_durations v WHERE ${cond}`),
  ])

  return {
    total: countRows[0]?.cnt ?? 0, page: q.page, limit: q.limit,
    items: rows.map((r: any) => ({
      applicationId: r.application_id, candidateId: r.candidate_id,
      candidateFirstName: r.first_name, candidateLastName: r.last_name,
      stageName: r.stage_name, jobTitle: r.job_title, changedAt: r.changed_at,
    })),
  }
})
