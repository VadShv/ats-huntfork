/**
 * Общие правила видимости для модуля «Обсуждение» — используются и сервером
 * (`server/utils/comments/visibility.ts`), и клиентом (замок «внутреннее»
 * в композере), чтобы наборы ролей не расходились.
 *
 * Правило (RBAC v2):
 *   - owner / admin / member / recruiter / lead_recruiter — видят внутренние
 *     сообщения и могут их писать ('member' — это и есть рекрутёр).
 *   - hiring_manager / external_recruiter — только is_internal = false.
 */
export const INTERNAL_VISIBLE_ROLES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'member',
  'recruiter',
  'lead_recruiter',
])

/** Роли, которым внутренние сообщения не видны (заказчики и внешние рекрутёры). */
export const EXTERNAL_AUDIENCE_ROLES: ReadonlySet<string> = new Set([
  'hiring_manager',
  'external_recruiter',
])

export function canSeeInternalRole(role: string | null | undefined): boolean {
  if (!role) return false
  return INTERNAL_VISIBLE_ROLES.has(role)
}

export function isExternalAudienceRole(role: string | null | undefined): boolean {
  if (!role) return false
  return EXTERNAL_AUDIENCE_ROLES.has(role)
}
