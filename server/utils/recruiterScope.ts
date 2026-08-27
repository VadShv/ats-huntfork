import { and, eq, inArray } from 'drizzle-orm'
import { member, user } from '../database/schema'
import { jobMember } from '../database/schema/hm'

/**
 * ─────────────────────────────────────────────
 * Скоуп рекрутера — «мои вакансии» (Sprint 20.2)
 * ─────────────────────────────────────────────
 *
 * Роль `member` (рекрутер) по умолчанию видит на дашбордах только те
 * вакансии, на которые назначена через job_member (member_role='recruiter').
 * Owner/admin видят всё (с разбивкой по рекрутерам на клиенте).
 *
 * Это НЕ граница безопасности (member имеет job:read на всю организацию),
 * а дефолтный фильтр видимости для рабочих экранов.
 */

/** Org-роль пользователя в организации (owner | admin | member | hiring_manager) */
export async function getOrgRole(orgId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  return row?.role ?? null
}

/** ID вакансий, на которые пользователь назначен рекрутером */
export async function getAssignedJobIds(orgId: string, userId: string): Promise<string[]> {
  const rows = await db
    .select({ jobId: jobMember.jobId })
    .from(jobMember)
    .where(and(
      eq(jobMember.organizationId, orgId),
      eq(jobMember.userId, userId),
      eq(jobMember.memberRole, 'recruiter'),
    ))
  return rows.map(r => r.jobId)
}

export interface RecruiterScope {
  /** org-роль пользователя */
  role: string | null
  /** true → выдачу нужно ограничить списком jobIds */
  scoped: boolean
  /** назначенные вакансии (только когда scoped=true) */
  jobIds: string[]
}

/**
 * Резолвит скоуп видимости вакансий.
 * @param override 'mine' | 'all' — явный выбор клиента (query-параметр `scope`).
 *   По умолчанию: member → 'mine', owner/admin → 'all'.
 */
export async function resolveRecruiterScope(orgId: string, userId: string, override?: 'mine' | 'all'): Promise<RecruiterScope> {
  const role = await getOrgRole(orgId, userId)
  const wantMine = override ? override === 'mine' : role === 'member'
  if (!wantMine) return { role, scoped: false, jobIds: [] }
  const jobIds = await getAssignedJobIds(orgId, userId)
  return { role, scoped: true, jobIds }
}

/** Рекрутеры набора вакансий: jobId → [{ userId, name }] (для группировки на клиенте) */
export async function getJobRecruitersMap(orgId: string, jobIds: string[]): Promise<Record<string, Array<{ userId: string, name: string }>>> {
  if (jobIds.length === 0) return {}
  const rows = await db
    .select({
      jobId: jobMember.jobId,
      userId: jobMember.userId,
      name: user.name,
    })
    .from(jobMember)
    .innerJoin(user, eq(user.id, jobMember.userId))
    .where(and(
      eq(jobMember.organizationId, orgId),
      inArray(jobMember.jobId, jobIds),
      eq(jobMember.memberRole, 'recruiter'),
    ))
  const map: Record<string, Array<{ userId: string, name: string }>> = {}
  for (const row of rows) {
    (map[row.jobId] ??= []).push({ userId: row.userId, name: row.name })
  }
  return map
}
