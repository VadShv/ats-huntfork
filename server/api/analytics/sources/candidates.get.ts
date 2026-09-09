import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { analyticsQuerySchema, resolvePeriod, mvFilterConditions, andAll } from '../../../utils/analytics/filters'
import { resolveAnalyticsScope } from '../../../utils/analytics/scope'

const schema = analyticsQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

/**
 * GET /api/analytics/sources/candidates?source= — drill-down кандидатов по источнику.
 * Список откликов, вошедших за период с указанного source.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const q = await getValidatedQuery(event, schema.parse)
  if (!q.source) throw createError({ statusCode: 400, statusMessage: 'source обязателен' })
  const { from, to } = resolvePeriod(q)
  const offset = (q.page - 1) * q.limit

  const scope = await resolveAnalyticsScope(orgId, session.user.id)
  const scopeCond = scope.jobIdCondition('v')
  const conds = mvFilterConditions('v', orgId, q)
  if (scopeCond) conds.push(scopeCond)
  conds.push(sql`v.entered_at >= ${from}`, sql`v.entered_at < ${to}`)

  const [rows, countRows]: any[] = await Promise.all([
    db.execute(sql`
      SELECT DISTINCT ON (v.application_id) v.application_id, c.id AS candidate_id, c.first_name, c.last_name,
        ps.name AS stage_name, j.title AS job_title, v.entered_at AS changed_at
      FROM mv_application_stage_durations v
      JOIN pipeline_stage ps ON ps.id = v.stage_id
      JOIN candidate c ON c.id = v.candidate_id
      JOIN job j ON j.id = v.job_id
      WHERE ${andAll(conds)} ORDER BY v.application_id, v.entered_at DESC LIMIT ${q.limit} OFFSET ${offset}
    `),
    db.execute(sql`SELECT count(DISTINCT v.application_id)::int AS cnt FROM mv_application_stage_durations v WHERE ${andAll(conds)}`),
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
