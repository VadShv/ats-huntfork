import { sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { andAll, type AnalyticsQuery } from './filters'
import type { AnalyticsScope } from './scope'

/**
 * Центр аналитики: единый snapshot «активных сейчас» откликов (Фаза 2, #6).
 *
 * Одна реализация для overview/jobs/recruiters — с ПОЛНЫМ набором фильтров
 * (job/source/pipeline/recruiter/department/company/scope). Без периода:
 * это состояние «прямо сейчас» (текущий этап в working-ветке).
 */
export async function countActiveNow(orgId: string, q: AnalyticsQuery, scope: AnalyticsScope): Promise<number> {
  const conds: SQL[] = [sql`a.organization_id = ${orgId}`, sql`ps.bucket = 'working'`]
  if (q.jobId) conds.push(sql`a.job_id = ${q.jobId}`)
  if (q.source) conds.push(sql`a.source = ${q.source}`)
  if (q.pipelineId) conds.push(sql`ps.pipeline_id = ${q.pipelineId}`)
  if (q.recruiterId) {
    conds.push(sql`a.job_id IN (
      SELECT jm.job_id FROM job_member jm
      WHERE jm.user_id = ${q.recruiterId} AND jm.member_role = 'recruiter'
    )`)
  }
  if (q.departmentId) conds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.department_id = ${q.departmentId})`)
  if (q.companyId) conds.push(sql`a.job_id IN (SELECT j.id FROM job j WHERE j.company_id = ${q.companyId})`)
  const scopeCond = scope.jobIdCondition('a')
  if (scopeCond) conds.push(scopeCond)

  const rows: any = await db.execute(sql`
    SELECT count(*)::int AS cnt
    FROM application a
    JOIN pipeline_stage ps ON ps.id = a.current_stage_id
    WHERE ${andAll(conds)}
  `)
  return rows[0]?.cnt ?? 0
}
