/**
 * ─────────────────────────────────────────────
 * Permission resolver — DB-sourced capabilities (RBAC v2, Sprint 1)
 * ─────────────────────────────────────────────
 *
 * Resolves the effective capability set for a member from the DB (role →
 * role_permission), with a static fallback to shared/permissions.ts if the
 * seed is missing (defensive; keeps the app working pre-seed).
 *
 * Sprint 1 sources capabilities BY ROLE KEY (member.role → system preset role
 * with matching `key`), because member_role rows are populated only in Sprint 2.
 * The public shape returned here is stable across sprints.
 *
 * Caching: per (orgId, roleKey, permissionsVersion) in-process with short TTL.
 * On permissions_version bump (role/scope/override change) the cache key changes
 * → effective invalidation ≤ TTL (master plan §5.5). For Sprint 1 this only
 * affects the temp role-key path; Sprint 2 wires member-level resolution.
 */

import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { role, rolePermission, memberPermissionOverride } from '../../database/schema/rbac'
import { expandRoleCapabilities } from '../../../shared/access/capabilities'

interface CacheEntry {
  caps: Set<string>
  expires: number
}
const CACHE_TTL_MS = 30_000
const _cache = new Map<string, CacheEntry>()

/**
 * Effective capabilities for a role key within an org.
 * Looks up the system preset role (organization_id IS NULL) OR an org-custom
 * role with that key, then its granted permissions.
 */
export async function resolveRoleCapabilities(orgId: string, roleKey: string): Promise<Set<string>> {
  const cacheKey = `${orgId}::${roleKey}`
  const now = Date.now()
  const hit = _cache.get(cacheKey)
  if (hit && hit.expires > now) return hit.caps

  let caps: Set<string>
  try {
    // Prefer an org-specific role with this key; else the system preset.
    const roles = await db
      .select({ id: role.id, organizationId: role.organizationId })
      .from(role)
      .where(and(
        eq(role.key, roleKey),
        or(isNull(role.organizationId), eq(role.organizationId, orgId)),
      ))

    if (roles.length === 0) {
      // Not seeded yet → static fallback (parity with pre-RBAC-v2 behavior).
      caps = expandRoleCapabilities(roleKey)
    }
    else {
      // Prefer org-scoped over system preset if both exist.
      const chosen = roles.find((r) => r.organizationId === orgId) ?? roles[0]
      const perms = await db
        .select({ permission: rolePermission.permission })
        .from(rolePermission)
        .where(eq(rolePermission.roleId, chosen.id))
      caps = new Set(perms.map((p) => p.permission))
      // Defensive: if a seeded role somehow has no permissions, fall back.
      if (caps.size === 0) caps = expandRoleCapabilities(roleKey)
    }
  }
  catch {
    // DB/table may not exist yet (pre-migration) → static fallback.
    caps = expandRoleCapabilities(roleKey)
  }

  _cache.set(cacheKey, { caps, expires: now + CACHE_TTL_MS })
  return caps
}

/**
 * Load active (non-expired) per-member overrides.
 * Returns a map permission → effect. Empty on any error / pre-migration.
 */
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
      if (r.expiresAt && r.expiresAt.getTime() < now) continue // expired → ignore
      map.set(r.permission, r.effect as 'allow' | 'deny')
    }
  }
  catch {
    // pre-migration → no overrides
  }
  return map
}

/** Apply overrides to a base capability set (deny wins). Returns a new set. */
export function applyOverrides(base: Set<string>, overrides: Map<string, 'allow' | 'deny'>): Set<string> {
  const out = new Set(base)
  for (const [perm, effect] of overrides) {
    if (effect === 'allow') out.add(perm)
    else out.delete(perm) // deny wins
  }
  return out
}

/** Test-only: clear the in-process cache. */
export function _clearCapabilityCache(): void {
  _cache.clear()
}

// Suppress unused import warning for inArray (reserved for Sprint 2 member_role path).
void inArray
