import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../../../../utils/db'
import { analyticsQuerySchema, resolvePeriod } from '../../../../utils/analytics/filters'
import { getOrgRole } from '../../../../utils/recruiterScope'
import { assertOrgAdmin } from '../../../../utils/analytics/scope'

const schema = analyticsQuerySchema.extend({
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

/**
 * GET /api/analytics/recruiters/:userId/interviews — drill-down интервью рекрутёра.
 * Только admin/owner. Опц. фильтр по статусу.
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

  const statusCond = q.status ? sql`AND i.status = ${q.status}` : sql``
  const cond = sql`i.organization_id = ${orgId} AND i.created_by_id = ${userId}
    AND i.scheduled_at >= ${from} AND i.scheduled_at < ${to} ${statusCond}`

  const [rows, countRows]: any[] = await Promise.all([
    db.execute(sql`
      SELECT i.id, i.type, i.status, i.scheduled_at, i.candidate_response,
        c.id AS candidate_id, c.first_name, c.last_name, j.title AS job_title, a.id AS application_id
      FROM interview i
      JOIN application a ON a.id = i.application_id
      JOIN candidate c ON c.id = a.candidate_id
      JOIN job j ON j.id = a.job_id
      WHERE ${cond} ORDER BY i.scheduled_at DESC LIMIT ${q.limit} OFFSET ${offset}
    `),
    db.execute(sql`SELECT count(*)::int AS cnt FROM interview i WHERE ${cond}`),
  ])

  return {
    total: countRows[0]?.cnt ?? 0, page: q.page, limit: q.limit,
    items: rows.map((r: any) => ({
      applicationId: r.application_id, candidateId: r.candidate_id,
      candidateFirstName: r.first_name, candidateLastName: r.last_name,
      stageName: `${r.type} · ${r.status}`, jobTitle: r.job_title, changedAt: r.scheduled_at,
    })),
  }
})
