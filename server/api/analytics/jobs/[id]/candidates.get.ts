import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../../../../utils/db'
import { analyticsQuerySchema, resolvePeriod, andAll } from '../../../../utils/analytics/filters'
import { resolveAnalyticsScope } from '../../../../utils/analytics/scope'
import { slaP90Cte, stuckCondition } from '../../../../utils/analytics/sla-threshold'

const schema = analyticsQuerySchema.extend({
  metric: z.enum(['active', 'hires', 'rejections', 'stuck']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

/**
 * GET /api/analytics/jobs/:id/candidates?metric= — drill-down кандидатов вакансии.
 * metric: active (сейчас в работе) | hires | rejections | stuck (>14 дней на этапе).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId
  const jobId = getRouterParam(event, 'id')!

  const scope = await resolveAnalyticsScope(orgId, session.user.id, q.scope)
  if (scope.scoped && !scope.jobIds.includes(jobId)) {
    throw createError({ statusCode: 403, statusMessage: 'Вакансия не в вашем скоупе' })
  }

  const q = await getValidatedQuery(event, schema.parse)
  const { from, to } = resolvePeriod(q)
  const offset = (q.page - 1) * q.limit

  let rows: any, countRows: any
  if (q.metric === 'active') {
    const cond = sql`a.organization_id = ${orgId} AND a.job_id = ${jobId} AND ps.bucket = 'working'`
    ;[rows, countRows] = await Promise.all([
      db.execute(sql`
        SELECT a.id AS application_id, c.id AS candidate_id, c.first_name, c.last_name,
          ps.name AS stage_name, a.stage_changed_at
        FROM application a JOIN pipeline_stage ps ON ps.id = a.current_stage_id
        JOIN candidate c ON c.id = a.candidate_id
        WHERE ${cond} ORDER BY a.stage_changed_at DESC NULLS LAST LIMIT ${q.limit} OFFSET ${offset}
      `),
      db.execute(sql`SELECT count(*)::int AS cnt FROM application a JOIN pipeline_stage ps ON ps.id = a.current_stage_id WHERE ${cond}`),
    ])
  }
  else if (q.metric === 'stuck') {
    const base = sql`v.organization_id = ${orgId} AND v.job_id = ${jobId} AND ${stuckCondition('v')}`
    ;[rows, countRows] = await Promise.all([
      db.execute(sql`
        WITH ${slaP90Cte(orgId)}
        SELECT v.application_id, c.id AS candidate_id, c.first_name, c.last_name,
          ps.name AS stage_name, v.entered_at AS stage_changed_at
        FROM mv_application_stage_durations v
        JOIN application a ON a.id = v.application_id AND a.current_stage_id = v.stage_id
        JOIN pipeline_stage ps ON ps.id = v.stage_id
        JOIN pipeline_stage rs ON rs.id = v.root_stage_id
        LEFT JOIN p90_by_root p ON p.root_stage_id = v.root_stage_id
        JOIN candidate c ON c.id = v.candidate_id
        WHERE ${base} ORDER BY v.entered_at ASC LIMIT ${q.limit} OFFSET ${offset}
      `),
      db.execute(sql`
        WITH ${slaP90Cte(orgId)}
        SELECT count(DISTINCT v.application_id)::int AS cnt
        FROM mv_application_stage_durations v
        JOIN application a ON a.id = v.application_id AND a.current_stage_id = v.stage_id
        JOIN pipeline_stage rs ON rs.id = v.root_stage_id
        LEFT JOIN p90_by_root p ON p.root_stage_id = v.root_stage_id
        WHERE ${base}
      `),
    ])
  }
  else {
    const typeCond = q.metric === 'hires' ? sql`v.stage_type = 'hired'` : sql`v.bucket = 'rejected'`
    const cond = sql`v.organization_id = ${orgId} AND v.job_id = ${jobId} AND ${typeCond} AND v.entered_at >= ${from} AND v.entered_at < ${to}`
    ;[rows, countRows] = await Promise.all([
      db.execute(sql`
        SELECT DISTINCT ON (v.application_id) v.application_id, c.id AS candidate_id, c.first_name, c.last_name,
          ps.name AS stage_name, v.entered_at AS stage_changed_at
        FROM mv_application_stage_durations v
        JOIN pipeline_stage ps ON ps.id = v.stage_id JOIN candidate c ON c.id = v.candidate_id
        WHERE ${cond} ORDER BY v.application_id, v.entered_at DESC LIMIT ${q.limit} OFFSET ${offset}
      `),
      db.execute(sql`SELECT count(DISTINCT v.application_id)::int AS cnt FROM mv_application_stage_durations v WHERE ${cond}`),
    ])
  }

  return {
    total: countRows[0]?.cnt ?? 0, page: q.page, limit: q.limit,
    items: rows.map((r: any) => ({
      applicationId: r.application_id, candidateId: r.candidate_id,
      candidateFirstName: r.first_name, candidateLastName: r.last_name,
      stageName: r.stage_name, changedAt: r.stage_changed_at,
    })),
  }
})
