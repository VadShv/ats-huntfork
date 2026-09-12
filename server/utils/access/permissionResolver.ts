/**
 * ─────────────────────────────────────────────
 * Permission resolver — DB-sourced capabilities (RBAC v2, Sprint 1→2)
 * ─────────────────────────────────────────────
 *
 * Sprint 2: resolves the effective capability set for a MEMBER from their
 * actual role assignments (member_role → role_permission), unioned across roles
 * (v2 assigns one, schema allows several for v3). Falls back to the role-key
 * path (member.role → system preset) if no member_role rows exist yet, and to
 * the static shared/permissions.ts map if the DB/seed is unavailable.
 *
 * Caching: keyed by (memberId, permissionsVersion) so a version bump on any
 * role/scope/override change invalidates immediately (master plan §5.5). Short
 * TTL bounds staleness even without a bump.
 */

import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { role, rolePermission, memberRole, memberPermissionOverride } from '../../database/schema/rbac'
import { expandRoleCapabilities } from '../../../shared/access/capabilities'

interface CacheEntry {
  caps: Set<string>
  expires: number
}
const CACHE_TTL_MS = 30_000
const _cache = new Map<string, CacheEntry>()

/** Capabilities for a role key (system preset or org-custom). Static fallback. */
export async function resolveRoleCapabilities(orgId: string, roleKey: string): Promise<Set<string>> {
  try {
    const roles = await db
      .select({ id: role.id, organizationId: role.organizationId })
      .from(role)
      .where(and(
        eq(role.key, roleKey),
        or(isNull(role.organizationId), eq(role.organizationId, orgId)),
      ))
    if (roles.length === 0) return expandRoleCapabilities(roleKey)
    const chosen = roles.find((r) => r.organizationId === orgId) ?? roles[0]
    const perms = await db
      .select({ permission: rolePermission.permission })
      .from(rolePermission)
      .where(eq(rolePermission.roleId, chosen.id))
    const caps = new Set(perms.map((p) => p.permission))
    return caps.size > 0 ? caps : expandRoleCapabilities(roleKey)
  }
  catch {
    return expandRoleCapabilities(roleKey)
  }
}

/**
 * Effective capabilities for a member. Prefers member_role assignments; if none,
 * falls back to the role-key path (roleKeyFallback = member.role).
 * Cached by (memberId, permissionsVersion).
 */
export async function resolveMemberCapabilities(
  memberId: string,
  orgId: string,
  roleKeyFallback: string,
  permissionsVersion: number,
): Promise<Set<string>> {
  const cacheKey = `${memberId}::${permissionsVersion}`
  const now = Date.now()
  const hit = _cache.get(cacheKey)
  if (hit && hit.expires > now) return hit.caps

  let caps: Set<string>
  try {
    // Role ids assigned to this member.
    const assigned = await db
      .select({ roleId: memberRole.roleId })
      .from(memberRole)
      .where(eq(memberRole.memberId, memberId))

    if (assigned.length === 0) {
      // Not backfilled yet → role-key path (caller lazily heals member_role).
      caps = await resolveRoleCapabilities(orgId, roleKeyFallback)
    }
    else {
      const roleIds = assigned.map((r) => r.roleId)
      const perms = await db
        .select({ permission: rolePermission.permission })
        .from(rolePermission)
        .where(inArray(rolePermission.roleId, roleIds))
      caps = new Set(perms.map((p) => p.permission))
      if (caps.size === 0) caps = await resolveRoleCapabilities(orgId, roleKeyFallback)
    }
  }
  catch {
    caps = expandRoleCapabilities(roleKeyFallback)
  }

  _cache.set(cacheKey, { caps, expires: now + CACHE_TTL_MS })
  return caps
}

/** Active (non-expired) per-member overrides. Empty on error / pre-migration. */
export async function resolveMemberOverrides(memberId: string): Promise<Map<string, 'allow' | 'deny'>> {
  const map = new Map<string, 'allow' | 'deny'>()
  try {
    const rows = await db
      .select({
        permission: memberPermissionOverride.permission,
        effect: memberPermissionOverride.effect,
        expiresAt: memberPermissionOverride.expiresAt,
      })
      .from(memberPermissionOverride)
      .where(eq(memberPermissionOverride.memberId, memberId))
    const now = Date.now()
    for (const r of rows) {
      if (r.expiresAt && r.expiresAt.getTime() < now) continue
      map.set(r.permission, r.effect as 'allow' | 'deny')
    }
  }
  catch { /* pre-migration */ }
  return map
}

/** Apply overrides to a base capability set (deny wins). Returns a new set. */
export function applyOverrides(base: Set<string>, overrides: Map<string, 'allow' | 'deny'>): Set<string> {
  const out = new Set(base)
  for (const [perm, effect] of overrides) {
    if (effect === 'allow') out.add(perm)
    else out.delete(perm)
  }
  return out
}

/** Test-only: clear the in-process cache. */
export function _clearCapabilityCache(): void {
  _cache.clear()
}
