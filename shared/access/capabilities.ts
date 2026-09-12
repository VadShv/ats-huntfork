/**
 * ─────────────────────────────────────────────
 * Capability expansion & checks (pure, no DB, no I/O)
 * ─────────────────────────────────────────────
 *
 * Part of RBAC v2 (Sprint 0.5). This module turns a role into a flat set of
 * `resource:action` capability strings and answers permission checks against
 * an access snapshot — synchronously, on both server and client.
 *
 * Why here (shared/):
 *   • Client (usePermission / usePermissions) reads the SSR snapshot and checks
 *     capabilities WITHOUT a Better Auth roundtrip → no UI flicker.
 *   • Server (getActorContext) builds the snapshot from the same source.
 *   • Pure functions → trivially unit-testable without a database (see
 *     docs/rbac-v2-master-plan.md §13.0 — matrix tests of can() as pure units).
 *
 * Source of truth for role→statements: shared/permissions.ts (ROLE_STATEMENTS).
 * Sprint 0.5 fills capabilities from the static role map ("temporary fill" per
 * the master plan §12); Sprints 1-2 will source them from the DB + can() engine
 * WITHOUT changing this module's public shape (AccessSnapshot / can()).
 */

import { ROLE_STATEMENTS, type RoleKey } from '../permissions'

/** A capability string, e.g. `candidate:read` or `candidate:read:contacts`. */
export type Capability = string

/** Scope model (final shape now; only the type is used in Sprint 0.5). */
export type ScopeType = 'org' | 'departments' | 'jobs' | 'assigned' | 'own' | 'hrbp'

export interface AccessScope {
  type: ScopeType
  departmentIds: string[]
  jobIds: string[]
}

/**
 * Serializable snapshot handed to the client via SSR (useState) and consumed by
 * usePermission/usePermissions. Final shape — Sprints 1-2 populate the same
 * fields from richer sources without breaking consumers.
 */
export interface AccessSnapshot {
  roleKeys: string[]
  /** Flat capability set as an array (JSON-serializable for the SSR payload). */
  capabilities: Capability[]
  scope: AccessScope
  flags: {
    canViewSalary: boolean
    mustChangePassword: boolean
    isViewAs: boolean
    /** Name of the member being viewed (for the view-as banner). */
    viewAsName?: string | null
  }
  status: string
}

/** Empty snapshot — used when there is no session / no active org. */
export function emptyAccessSnapshot(): AccessSnapshot {
  return {
    roleKeys: [],
    capabilities: [],
    scope: { type: 'own', departmentIds: [], jobIds: [] },
    flags: { canViewSalary: false, mustChangePassword: false, isViewAs: false },
    status: 'none',
  }
}

/**
 * Expand a single role key into its flat capability set (`resource:action`).
 * Unknown roles yield an empty set (deny-by-default).
 */
export function expandRoleCapabilities(roleKey: string): Set<Capability> {
  const statements = ROLE_STATEMENTS[roleKey as RoleKey]
  const out = new Set<Capability>()
  if (!statements) return out
  for (const [resource, actions] of Object.entries(statements)) {
    for (const action of actions as readonly string[]) {
      out.add(`${resource}:${action}`)
    }
  }
  return out
}

/**
 * Expand one or more role keys into their union of capabilities.
 * (Union supports v3 multi-role; v2 always passes a single role.)
 */
export function expandRolesCapabilities(roleKeys: string[]): Set<Capability> {
  const out = new Set<Capability>()
  for (const key of roleKeys) {
    for (const cap of expandRoleCapabilities(key)) out.add(cap)
  }
  return out
}

/**
 * Permission-request shape shared with the server guard, e.g.
 * `{ job: ['create'] }` or `{ candidate: ['read', 'update'] }`.
 */
export type PermissionRequest = Record<string, ReadonlyArray<string>>

/**
 * Does the snapshot satisfy EVERY requested resource:action?
 * Deny-by-default: unknown/empty snapshot → false. View-as never grants writes.
 */
export function snapshotCan(
  snapshot: AccessSnapshot | null | undefined,
  request: PermissionRequest,
): boolean {
  if (!snapshot || snapshot.capabilities.length === 0) return false
  const caps = new Set(snapshot.capabilities)
  const WRITE = new Set(['create', 'update', 'delete'])
  for (const [resource, actions] of Object.entries(request)) {
    for (const action of actions) {
      // View-as is strictly read-only — never allow writes even if role has them.
      if (snapshot.flags.isViewAs && WRITE.has(action)) return false
      if (!caps.has(`${resource}:${action}`)) return false
    }
  }
  return true
}
