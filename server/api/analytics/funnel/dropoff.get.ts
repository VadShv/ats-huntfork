import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { analyticsQuerySchema, resolvePeriod, andAll } from '../../../utils/analytics/filters'

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

  // Когортная семантика (согласовано с funnel.get.ts rejectedFromStage[X]):
  // отклики когорты (created_at ∈ период), достигшие root-этапа stageId
  // и ушедшие С него в rejected-ветку. DISTINCT по application_id (устойчиво
  // к повторным визитам). total == rejectedFromStage[stageId] из воронки.
  const cohortConds = [
    sql`a.organization_id = ${orgId}`,
    sql`a.created_at >= ${from}`,
    sql`a.created_at < ${to}`,
  ]
  if (q.jobId) cohortConds.push(sql`a.job_id = ${q.jobId}`)
  if (q.source) cohortConds.push(sql`a.source = ${q.source}`)
  if (q.pipelineId) cohortConds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.pipeline_id = ${q.pipelineId})`)
  if (q.recruiterId) {
    cohortConds.push(sql`a.job_id IN (SELECT jm.job_id FROM job_member jm WHERE jm.user_id = ${q.recruiterId} AND jm.member_role = 'recruiter')`)
  }
  if (q.departmentId) cohortConds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.department_id = ${q.departmentId})`)
  if (q.companyId) cohortConds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.company_id = ${q.companyId})`)
  const cohortSQL = sql`SELECT a.id FROM application a WHERE ${andAll(cohortConds)}`

  const dropCond = sql`v.application_id IN (${cohortSQL})
    AND v.root_stage_id = ${q.stageId}
    AND next_ps.bucket = 'rejected'`

  const [rows, countRows]: any[] = await Promise.all([
    db.execute(sql`
      SELECT DISTINCT ON (v.application_id)
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
      WHERE ${dropCond}
      ORDER BY v.application_id, v.exited_at DESC
      LIMIT ${q.limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT count(DISTINCT v.application_id)::int AS cnt
      FROM mv_application_stage_durations v
      JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
      WHERE ${dropCond}
    `),
  ])

  return {
    period: { from, to },
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
