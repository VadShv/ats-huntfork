/**
 * ─────────────────────────────────────────────
 * System role presets (RBAC v2, Sprint 1) — seed definitions
 * ─────────────────────────────────────────────
 *
 * Defines the capability set + default scope for every SYSTEM preset role.
 * These are seeded into `role` + `role_permission`.
 *
 * Parity guarantee: owner / admin / member / hiring_manager derive their
 * capabilities DIRECTLY from shared/permissions.ts (ROLE_ATS_STATEMENTS), so
 * the DB seed is byte-for-byte equivalent to the current static Better Auth AC.
 * This makes Sprint 1 shadow-mode show ZERO divergence before Sprint 2 switches
 * enforcement to can(). (master plan §12 Sprint 1)
 *
 * New presets (lead_recruiter / recruiter / junior_recruiter) are seeded but
 * NOT assigned to anyone yet — assignment/customization is Sprints 2/7.
 *
 * lead_recruiter starts from a sensible default and is meant to be tuned in the
 * matrix UI (Sprint 7); note `aiConfig` example intent: view AI config but not
 * edit — expressed here as scoring:read only (AI config currently rides on
 * scoring; dedicated aiConfig resource is a later refinement, plan §8.3).
 */

import { expandRoleCapabilities } from './capabilities'
import type { ScopeType } from './capabilities'

export interface RolePreset {
  key: string
  nameRu: string
  nameEn: string
  descriptionRu: string
  defaultScope: ScopeType
  isAssignable: boolean
  sortOrder: number
  /** Effective capability keys (`resource:action[:fieldSet]`). */
  capabilities: string[]
}

// Helpers to build capability lists concisely.
function caps(map: Record<string, readonly string[]>): string[] {
  const out: string[] = []
  for (const [resource, actions] of Object.entries(map)) {
    for (const a of actions) out.push(`${resource}:${a}`)
  }
  return out
}

// ── PII field-set permissions (Sprint 3) ──
// Granted to roles that must see candidate contacts/salary so that enabling
// masking-by-default does NOT change behavior for existing owner/admin/member.
// junior_recruiter intentionally omits them (PII hidden); hiring_manager salary
// stays gated separately by member.hmCanViewSalary in the HM endpoints.
const PII_CONTACTS = 'candidate:read:contacts'
const PII_SALARY = 'candidate:read:salary'

// ── owner / admin / member / hiring_manager: parity with static AC + PII ──
// expandRoleCapabilities gives the exact static-AC set; we then ADD the PII
// field-set grants (which the static AC never modeled) to preserve today's
// behavior where these roles see contacts/salary.
const ownerCaps = [...expandRoleCapabilities('owner'), PII_CONTACTS, PII_SALARY]
const adminCaps = [...expandRoleCapabilities('admin'), PII_CONTACTS, PII_SALARY]
const memberCaps = [...expandRoleCapabilities('member'), PII_CONTACTS, PII_SALARY]
const hiringManagerCaps = Array.from(expandRoleCapabilities('hiring_manager'))

// ── recruiter: same as current member (recruiter) ──
// The current 'member' role IS the recruiter. We keep 'member' for parity and
// add 'recruiter' as an explicit synonym preset for the new naming.
const recruiterCaps = [...memberCaps]

// ── junior_recruiter: minimal — pipeline work on assigned jobs, PII hidden ──
const juniorRecruiterCaps = caps({
  organization: ['read'],
  job: ['read'],
  candidate: ['create', 'read'],
  application: ['create', 'read', 'update'], // move through stages
  document: ['read'],
  comment: ['create', 'read'],
  interview: ['read'],
  activityLog: ['read'],
  pipeline: ['read'],
  company: ['read'],
  department: ['read'],
})

// ── lead_recruiter: broad default, tunable in matrix UI ──
// All recruiter capabilities + org-wide scope over departments + can see
// analytics/scoring; AI config VIEW-ONLY (scoring:read, not scoring:create).
const leadRecruiterCaps = caps({
  organization: ['read'],
  job: ['create', 'read', 'update'],
  candidate: ['create', 'read', 'update'],
  application: ['create', 'read', 'update'],
  document: ['create', 'read'],
  comment: ['create', 'read', 'delete'],
  interview: ['create', 'read', 'update'],
  emailTemplate: ['create', 'read', 'update'],
  activityLog: ['read'],
  scoring: ['read'], // example: sees AI/scoring config but cannot edit
  sourceTracking: ['read'],
  pipeline: ['read'],
  company: ['read'],
  department: ['read'],
})
// lead_recruiter sees candidate PII (contacts + salary) within its scope.
leadRecruiterCaps.push(PII_CONTACTS, PII_SALARY)

export const ROLE_PRESETS: RolePreset[] = [
  {
    key: 'owner',
    nameRu: 'Владелец', nameEn: 'Owner',
    descriptionRu: 'Полный доступ, биллинг и передача владения. Нельзя удалить последнего.',
    defaultScope: 'org', isAssignable: true, sortOrder: 0,
    capabilities: ownerCaps,
  },
  {
    key: 'admin',
    nameRu: 'Администратор', nameEn: 'Administrator',
    descriptionRu: 'Полный доступ к настройкам, ролям и интеграциям.',
    defaultScope: 'org', isAssignable: true, sortOrder: 10,
    capabilities: adminCaps,
  },
  {
    key: 'lead_recruiter',
    nameRu: 'Ведущий рекрутер', nameEn: 'Lead Recruiter',
    descriptionRu: 'Видит всю организацию по умолчанию; при необходимости ограничивается отделами/компаниями через scope. Аналитика команды. Права тонко настраиваются.',
    // §2: default scope org (sees everything). Narrow a specific lead via a
    // per-member scope override (departments/company) in the access UI.
    defaultScope: 'org', isAssignable: true, sortOrder: 20,
    capabilities: leadRecruiterCaps,
  },
  {
    key: 'member',
    nameRu: 'Рекрутер', nameEn: 'Recruiter',
    descriptionRu: 'Полный цикл кандидата на своих вакансиях. Без удаления вакансий и массового экспорта.',
    defaultScope: 'assigned', isAssignable: true, sortOrder: 30,
    capabilities: memberCaps,
  },
  {
    key: 'recruiter',
    nameRu: 'Рекрутер', nameEn: 'Recruiter',
    descriptionRu: 'Синоним роли «Рекрутер» в новой номенклатуре (тот же набор прав, что member).',
    defaultScope: 'assigned', isAssignable: false, sortOrder: 31,
    capabilities: recruiterCaps,
  },
  {
    key: 'junior_recruiter',
    nameRu: 'Младший рекрутер', nameEn: 'Junior Recruiter',
    descriptionRu: 'Минимум: карточки и перемещение по этапам на назначенных вакансиях, PII скрыт.',
    defaultScope: 'assigned', isAssignable: true, sortOrder: 40,
    capabilities: juniorRecruiterCaps,
  },
  {
    key: 'hiring_manager',
    nameRu: 'Нанимающий менеджер', nameEn: 'Hiring Manager',
    descriptionRu: 'Только чтение; решения об интервью — через отдельный кабинет.',
    defaultScope: 'jobs', isAssignable: true, sortOrder: 50,
    capabilities: hiringManagerCaps,
  },
]

export const ROLE_PRESET_BY_KEY: Record<string, RolePreset> = Object.fromEntries(
  ROLE_PRESETS.map((p) => [p.key, p]),
)
