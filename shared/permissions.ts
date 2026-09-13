/**
 * ─────────────────────────────────────────────
 * Centralized Access Control — single source of truth
 * ─────────────────────────────────────────────
 *
 * This file defines EVERY permission in the system.  It is imported by
 * both the server (auth.ts) and the client (auth-client.ts) so roles
 * and statements are always in sync.
 *
 * Design principles:
 *   • Deny by default — if a permission isn't listed here, it's denied.
 *   • Three built-in roles only (owner / admin / member) — no custom ones.
 *   • Import from `better-auth/plugins/access` to keep bundle small.
 *   • Merge with `defaultStatements` so Better Auth's own org/member/invitation
 *     permissions are preserved alongside our ATS-specific ones.
 */

import { createAccessControl } from 'better-auth/plugins/access'
import {
  defaultStatements,
  adminAc,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access'

// ─── ATS-specific resource → action map ────────────────────────────
// Every resource the app manages is declared here with its allowed actions.
// `as const` is mandatory for TypeScript inference.

const atsStatements = {
  organization: ['read', 'update', 'delete'],
  job: ['create', 'read', 'update', 'delete'],
  candidate: ['create', 'read', 'update', 'delete'],
  application: ['create', 'read', 'update', 'delete'],
  document: ['create', 'read', 'update', 'delete'],
  comment: ['create', 'read', 'update', 'delete'],
  interview: ['create', 'read', 'update', 'delete'],
  emailTemplate: ['create', 'read', 'update', 'delete'],
  activityLog: ['read'],
  scoring: ['create', 'read', 'update', 'delete'],
  sourceTracking: ['create', 'read', 'update', 'delete'],
  pipeline: ['create', 'read', 'update', 'delete'],
  company: ['create', 'read', 'update', 'delete'],
  department: ['create', 'read', 'update', 'delete'],
  // §7: narrow "add hiring manager" capability (declared so requirePermission
  // types it). Grants live in role presets (DB), not the static AC.
  hiringManager: ['create'],
  // §E: AI reply assistant ("суфлёр"). Declared for types; granted in presets.
  assistant: ['suggest'],
} as const

// ─── Merged statement (Better Auth defaults + ATS resources) ───────
export const statements = {
  ...defaultStatements,
  ...atsStatements,
} as const

// ─── Access Controller ─────────────────────────────────────────────
export const ac = createAccessControl(statements)

// ─── Role definitions ──────────────────────────────────────────────
//
// owner   — org creator.  EVERYTHING including delete org / manage billing.
// admin   — hiring managers.  Full CRUD on ATS resources + invite members.
// member  — recruiters.  Read jobs, manage candidates/applications in pipeline.

// ─── Raw ATS role→statements maps (single source of truth) ─────────
//
// These plain objects hold ONLY the ATS-specific statements per role.
// They are (a) passed to `ac.newRole()` below for Better Auth, and
// (b) exported so the RBAC v2 access layer (getActorContext / capability
// snapshot / can()) can expand them into `resource:action` strings WITHOUT
// introspecting Better Auth internals. Keep this the single source of truth.

export const ownerAtsStatements = {
  organization: ['read', 'update', 'delete'],
  job: ['create', 'read', 'update', 'delete'],
  candidate: ['create', 'read', 'update', 'delete'],
  application: ['create', 'read', 'update', 'delete'],
  document: ['create', 'read', 'update', 'delete'],
  comment: ['create', 'read', 'update', 'delete'],
  interview: ['create', 'read', 'update', 'delete'],
  emailTemplate: ['create', 'read', 'update', 'delete'],
  activityLog: ['read'],
  scoring: ['create', 'read', 'update', 'delete'],
  sourceTracking: ['create', 'read', 'update', 'delete'],
  pipeline: ['create', 'read', 'update', 'delete'],
  company: ['create', 'read', 'update', 'delete'],
  department: ['create', 'read', 'update', 'delete'],
} as const

export const adminAtsStatements = {
  organization: ['read', 'update', 'delete'],
  job: ['create', 'read', 'update', 'delete'],
  candidate: ['create', 'read', 'update', 'delete'],
  application: ['create', 'read', 'update', 'delete'],
  document: ['create', 'read', 'update', 'delete'],
  comment: ['create', 'read', 'update', 'delete'],
  interview: ['create', 'read', 'update', 'delete'],
  emailTemplate: ['create', 'read', 'update', 'delete'],
  activityLog: ['read'],
  scoring: ['create', 'read', 'update', 'delete'],
  sourceTracking: ['create', 'read', 'update', 'delete'],
  pipeline: ['create', 'read', 'update', 'delete'],
  company: ['create', 'read', 'update', 'delete'],
  department: ['create', 'read', 'update', 'delete'],
} as const

export const memberAtsStatements = {
  organization: ['read'],
  // Рекрутер ведёт вакансии: создаёт их (с авто-назначением себя
  // рекрутером), меняет настройки (воронка, назначение НМ).
  // Удаление вакансий — только owner/admin.
  job: ['create', 'read', 'update'],
  candidate: ['create', 'read', 'update'],
  application: ['create', 'read', 'update'],
  document: ['create', 'read'],
  comment: ['create', 'read', 'delete'],
  interview: ['create', 'read', 'update'],
  emailTemplate: ['create', 'read', 'update'],
  activityLog: ['read'],
  scoring: ['create', 'read'],
  sourceTracking: ['read'],
  pipeline: ['read'],
  // Справочники оргструктуры ведут owner/admin; рекрутер только читает (селекты в вакансии).
  company: ['read'],
  department: ['read'],
} as const

export const owner = ac.newRole({
  ...ownerAc.statements,
  ...ownerAtsStatements,
})

export const admin = ac.newRole({
  ...adminAc.statements,
  ...adminAtsStatements,
})

export const member = ac.newRole({
  ...memberAc.statements,
  ...memberAtsStatements,
})

// hiring_manager — Нанимающий менеджер (Sprint 20.1).
// Read-only везде в ATS. Все действия (одобрить/отклонить) — через отдельные /api/hm/*
// эндпоинты, которые внутри себя вызывают единый API перехода этапа
// в системном контексте. Сам НМ не может update напрямую.
//
// Видимость части комментариев (is_internal=true) скрыта на уровне
// server/utils/comments/visibility.ts (уже было).
export const hiringManagerAtsStatements = {
  organization: ['read'],
  job: ['read'],
  candidate: ['read'],
  application: ['read'],
  document: ['read'],
  comment: ['read'],
  interview: ['read'],
  activityLog: ['read'],
  scoring: ['read'],
  pipeline: ['read'],
  company: ['read'],
  department: ['read'],
} as const

export const hiringManager = ac.newRole({
  ...memberAc.statements,
  ...hiringManagerAtsStatements,
})

// ─── Better Auth default org statements per role (parity mirror) ───
// Mirrors better-auth/plugins/organization/access defaults so capability
// expansion matches auth.api.hasPermission exactly (member/invitation/team/ac).
// Source: node_modules/better-auth/.../organization/access/statement.mjs.
// ATS statements override these on overlapping resources (spread order below).
const ownerDefaultStatements = {
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
} as const
const adminDefaultStatements = {
  organization: ['update'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
} as const
const memberDefaultStatements = {
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ['read'],
} as const

// ─── Role → FULL merged statements registry (for capability expansion) ───
// Merge = { ...betterAuthDefaults, ...ATS } so ATS wins on overlap — this is the
// EXACT same merge as ac.newRole() above, guaranteeing shadow-mode parity.
// hiring_manager is included so the client can finally reason about it
// (fixes the auth-client.ts gap where HM was unregistered).
export const ROLE_STATEMENTS = {
  owner: { ...ownerDefaultStatements, ...ownerAtsStatements },
  admin: { ...adminDefaultStatements, ...adminAtsStatements },
  member: { ...memberDefaultStatements, ...memberAtsStatements },
  // hiring_manager derives from memberAc defaults (see ac.newRole above).
  hiring_manager: { ...memberDefaultStatements, ...hiringManagerAtsStatements },
} as const

/** @deprecated use ROLE_STATEMENTS — kept for back-compat of imports. */
export const ROLE_ATS_STATEMENTS = ROLE_STATEMENTS

export type RoleKey = keyof typeof ROLE_STATEMENTS
