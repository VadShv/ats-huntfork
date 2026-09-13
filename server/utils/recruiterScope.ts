import { and, eq, inArray } from 'drizzle-orm'
import { member, user } from '../database/schema'
import { jobMember } from '../database/schema/hm'
import { resolveUserScopeJobIds, getPersonalJobIds } from './access/scope'

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
 * Резолвит скоуп видимости вакансий. UNIFIED (RBAC v2 Фаза 2, Спринт A):
 * теперь role-aware для ВСЕХ ролей через v2 `resolveUserScopeJobIds`.
 *
 * - `override='mine'` → личные вакансии пользователя (job_member), для ЛЮБОЙ роли.
 * - `override='all'` ИЛИ без override → ПОЛНЫЙ scope роли:
 *     owner/admin/member/lead (org) → unrestricted (scoped=false);
 *     hrbp → его компании/отделы; external → assigned; hiring_manager → jobs.
 *
 * §A2: member дефолт scope = org (видит всё). Тумблер «Мои/Все» — это override,
 * а не граница доступа. Единый источник для списков/дашборда/аналитики → цифры
 * совпадают.
 */
export async function resolveRecruiterScope(orgId: string, userId: string, override?: 'mine' | 'all'): Promise<RecruiterScope> {
  const role = await getOrgRole(orgId, userId)

  // "Мои" — личные вакансии (job_member), для любой роли.
  if (override === 'mine') {
    const jobIds = await getPersonalJobIds(orgId, userId)
    return { role, scoped: true, jobIds }
  }

  // Полный scope роли (default или override='all').
  const scopeIds = await resolveUserScopeJobIds(orgId, userId)
  if (scopeIds === null) return { role, scoped: false, jobIds: [] } // unrestricted (org)
  return { role, scoped: true, jobIds: scopeIds }
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
