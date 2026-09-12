/**
 * ─────────────────────────────────────────────
 * ensureMemberRbac — keep member_role / member_scope in sync (RBAC v2, Sprint 2)
 * ─────────────────────────────────────────────
 *
 * Idempotent projection of a member's denormalized `member.role` (the primary
 * preset) into the RBAC v2 assignment tables:
 *   • member_role  — ties the member to the SYSTEM PRESET role with that key.
 *   • member_scope — seeds the default scope for that role (if absent).
 *
 * Called from:
 *   • the three custom member inserts (invite-link accept, join-request approve,
 *     hiring-manager create) — inside their transactions;
 *   • Better Auth lifecycle hooks (afterCreateOrganization / afterAcceptInvitation
 *     / afterUpdateMemberRole);
 *   • lazily from getActorContext() as a SELF-HEALING safety net, so a member
 *     created by any un-instrumented path still gets correct effective perms
 *     (derived from member.role, which is always set).
 *
 * On a role CHANGE we replace the primary member_role and reset scope to the new
 * role's default, then bump member.permissions_version to invalidate caches
 * (≤ TTL, master plan §5.5).
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { member } from '../../database/schema/auth'
import { role, memberRole, memberScope } from '../../database/schema/rbac'
import { ROLE_PRESET_BY_KEY } from '../../../shared/access/role-presets'

// Minimal executor type so this works with both `db` and a transaction `tx`.
type Executor = {
  select: typeof db.select
  insert: typeof db.insert
  update: typeof db.update
}

/**
 * Resolve the role id for a role key within an org: prefer an org-custom role
 * with that key, else the system preset (organization_id IS NULL).
 */
async function resolveRoleId(exec: Executor, orgId: string, roleKey: string): Promise<string | null> {
  const rows = await exec
    .select({ id: role.id, organizationId: role.organizationId })
    .from(role)
    .where(and(
      eq(role.key, roleKey),
      or(isNull(role.organizationId), eq(role.organizationId, orgId)),
    ))
  if (rows.length === 0) return null
  return (rows.find((r) => r.organizationId === orgId) ?? rows[0]).id
}

/**
 * Ensure the member has a primary member_role for `roleKey` and a member_scope.
 * Idempotent. If a different primary role exists, it is replaced (role change).
 *
 * @returns true if anything changed (caller may bump version / log).
 */
export async function ensureMemberRbac(
  exec: Executor,
  params: { memberId: string; organizationId: string; roleKey: string; scopeType?: string },
): Promise<boolean> {
  const { memberId, organizationId, roleKey } = params
  const roleId = await resolveRoleId(exec, organizationId, roleKey)
  if (!roleId) {
    // Preset not seeded yet (pre-seed boot) — nothing to do; lazy path retries later.
    return false
  }

  let changed = false

  // ── member_role: ensure exactly one primary = this role ──
  const existing = await exec
    .select({ roleId: memberRole.roleId, isPrimary: memberRole.isPrimary })
    .from(memberRole)
    .where(eq(memberRole.memberId, memberId))

  const hasThisPrimary = existing.some((r) => r.roleId === roleId && r.isPrimary)
  if (!hasThisPrimary) {
    // Demote any other primary rows, then upsert this one as primary.
    if (existing.some((r) => r.isPrimary)) {
      await exec.update(memberRole).set({ isPrimary: false }).where(eq(memberRole.memberId, memberId))
    }
    await exec
      .insert(memberRole)
      .values({ memberId, roleId, organizationId, isPrimary: true })
      .onConflictDoUpdate({
        target: [memberRole.memberId, memberRole.roleId],
        set: { isPrimary: true, organizationId },
      })
    changed = true
  }

  // ── member_scope: seed default scope if absent ──
  const scopeType = params.scopeType ?? ROLE_PRESET_BY_KEY[roleKey]?.defaultScope ?? 'assigned'
  const scopeRows = await exec
    .select({ memberId: memberScope.memberId })
    .from(memberScope)
    .where(eq(memberScope.memberId, memberId))
  if (scopeRows.length === 0) {
    await exec
      .insert(memberScope)
      .values({ memberId, organizationId, scopeType })
      .onConflictDoNothing({ target: memberScope.memberId })
    changed = true
  }

  return changed
}

/** Bump member.permissions_version to invalidate caches (uses global db). */
export async function bumpPermissionsVersion(memberId: string): Promise<void> {
  await db
    .update(member)
    .set({ permissionsVersion: sql`${member.permissionsVersion} + 1` })
    .where(eq(member.id, memberId))
}

/**
 * Full sync + version bump on a role change (uses global db).
 * Replaces the primary role, resets scope to the new role default, bumps version.
 */
export async function syncMemberRoleChange(
  memberId: string,
  organizationId: string,
  newRoleKey: string,
): Promise<void> {
  // Reset scope to the new role's default on a role change.
  const scopeType = ROLE_PRESET_BY_KEY[newRoleKey]?.defaultScope ?? 'assigned'
  await db
    .update(memberScope)
    .set({ scopeType, departmentIds: [], jobIds: [], updatedAt: new Date() })
    .where(eq(memberScope.memberId, memberId))
    .catch(() => {})
  await ensureMemberRbac(db as unknown as Executor, { memberId, organizationId, roleKey: newRoleKey, scopeType })
  await bumpPermissionsVersion(memberId)
}
