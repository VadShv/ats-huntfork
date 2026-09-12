/**
 * ─────────────────────────────────────────────
 * can() — the single access-decision function (RBAC v2, Sprint 1)
 * ─────────────────────────────────────────────
 *
 * Deny-by-default decision engine (master plan §5.2). Sprint 1 implements the
 * decision ordering and capability/override/view-as/cross-org checks. Scope
 * filtering + field masking (the 'filtered' branch) are wired in Sprint 3.
 *
 * `can()` operates purely on an already-resolved ActorContext (no I/O), so it is
 * unit-testable without a DB (master plan §13.0). The DB work happens once in
 * getActorContext().
 */

import type { ActorContext } from './actorContext'

export type PermissionKey = string // 'candidate:read' | 'candidate:read:contacts' | ...

export interface ResourceRef {
  type: string
  id?: string
  orgId?: string
  ownerId?: string
  jobId?: string
  departmentId?: string
}

export type Decision =
  | { effect: 'allow' }
  | { effect: 'deny'; reason: string }
  | { effect: 'filtered'; maskedFields: string[] } // scope/mask — enriched in Sprint 3

const WRITE_ACTIONS = new Set(['create', 'update', 'delete', 'export'])

function actionOf(permission: PermissionKey): string {
  // 'resource:action' or 'resource:action:fieldSet'
  return permission.split(':')[1] ?? ''
}

/**
 * Decide whether `actor` may perform `permission`, optionally on `resource`.
 * Pure and synchronous.
 */
export function can(
  actor: ActorContext | null,
  permission: PermissionKey,
  resource?: ResourceRef,
): Decision {
  // 1. Deny by default
  if (!actor) return { effect: 'deny', reason: 'no_actor' }

  // 2. Cross-org guard (potential IDOR) — resource must belong to actor's org
  if (resource?.orgId && resource.orgId !== actor.orgId) {
    return { effect: 'deny', reason: 'cross_org' }
  }

  // 3. Active membership (revoked/inactive → deny)
  if (actor.status !== 'active') {
    return { effect: 'deny', reason: `member_${actor.status}` }
  }

  // 4. View-as is strictly read-only
  if (actor.isViewAs && WRITE_ACTIONS.has(actionOf(permission))) {
    return { effect: 'deny', reason: 'view_as_readonly' }
  }

  // 5/6. Capability present? (overrides already folded into actor.permissions;
  //      deny overrides removed the key, allow overrides added it.)
  if (!actor.permissions.has(permission)) {
    return { effect: 'deny', reason: 'no_permission' }
  }

  // 7/8. ABAC + scope filtering → Sprint 3 (returns 'filtered' with maskedFields).
  return { effect: 'allow' }
}

/** Convenience boolean form. */
export function canBool(
  actor: ActorContext | null,
  permission: PermissionKey,
  resource?: ResourceRef,
): boolean {
  return can(actor, permission, resource).effect !== 'deny'
}

/**
 * Check a permission-request map ({ job: ['create'] }) — every action must pass.
 * Used by requirePermission's new-path (shadow-mode).
 */
export function canRequest(
  actor: ActorContext | null,
  request: Record<string, ReadonlyArray<string>>,
  resource?: ResourceRef,
): Decision {
  for (const [resourceKey, actions] of Object.entries(request)) {
    for (const action of actions) {
      const d = can(actor, `${resourceKey}:${action}`, resource)
      if (d.effect === 'deny') return d
    }
  }
  return { effect: 'allow' }
}
