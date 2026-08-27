/**
 * Утилиты для роли «Нанимающий менеджер» (Sprint 20.2).
 *
 * Использование см. docs/tz-hiring-manager-role-v1.md
 *
 * Ключевые функции:
 *   • generateTemporaryPassword — безопасный временный пароль для лично-выдачи.
 *   • getHmFlags — читает per-org флаги HM (роль + canViewSalary + mustChangePassword).
 *   • isHiringManagerOnJob — проверка "этот пользователь HM на этой вакансии".
 */

import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { member } from '../database/schema/auth'
import { jobMember } from '../database/schema/hm'

// `db` — глобальный Nuxt auto-import из server/utils/database.ts.

const HM_ROLE = 'hiring_manager' as const

/**
 * Читаемый временный пароль — 12 символов, без похожих 0/O/1/l/I.
 * Выдаётся рекрутером лично; при первом входе НМ обязан сменить.
 */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz'
  const buf = randomBytes(16)
  let out = ''
  for (let i = 0; i < 12; i++) {
    out += alphabet[buf[i] % alphabet.length]
  }
  return out
}

/**
 * Возвращает per-org HM-флаги пользователя или null, если он не член org.
 */
export async function getHmFlags(
  organizationId: string,
  userId: string,
): Promise<{
  role: string
  status: string
  canViewSalary: boolean
  mustChangePassword: boolean
} | null> {
  const row = await db
    .select({
      role: member.role,
      status: member.status,
      canViewSalary: member.hmCanViewSalary,
      mustChangePassword: member.mustChangePassword,
    })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)

  if (row.length === 0) return null
  return row[0]
}

/**
 * true, если userId назначен HM на jobId в данной org.
 * НЕ проверяет статус member — вызывающий должен проверить сессию/status отдельно.
 */
export async function isHiringManagerOnJob(
  organizationId: string,
  userId: string,
  jobId: string,
): Promise<boolean> {
  const row = await db
    .select({ id: jobMember.id })
    .from(jobMember)
    .where(and(
      eq(jobMember.organizationId, organizationId),
      eq(jobMember.userId, userId),
      eq(jobMember.jobId, jobId),
      eq(jobMember.memberRole, HM_ROLE),
    ))
    .limit(1)
  return row.length > 0
}

/**
 * Список всех вакансий, где userId — HM.
 */
export async function listJobsForHiringManager(
  organizationId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ jobId: jobMember.jobId })
    .from(jobMember)
    .where(and(
      eq(jobMember.organizationId, organizationId),
      eq(jobMember.userId, userId),
      eq(jobMember.memberRole, HM_ROLE),
    ))
  return rows.map(r => r.jobId)
}

export { HM_ROLE }
