/**
 * ─────────────────────────────────────────────
 * RBAC v2 seed — permission catalog + system role presets (Sprint 1)
 * ─────────────────────────────────────────────
 *
 * Idempotent. Seeds:
 *   • `permission` — full catalog derived from the resource registry.
 *   • `role`       — system presets (organization_id NULL, is_system=true).
 *   • `role_permission` — each preset's granted capabilities.
 *
 * Parity: owner/admin/member/hiring_manager get EXACTLY the capabilities of the
 * current static Better Auth AC (see role-presets.ts), so shadow-mode diverges
 * nowhere before Sprint 2 flips enforcement.
 *
 * Safe to run on every boot: uses upserts / existence checks and only ADDS
 * missing permission grants (never revokes, to avoid clobbering future custom
 * edits to system presets — though system presets are not user-editable).
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { permission, role, rolePermission, memberRole, memberScope } from '../../database/schema/rbac'
import { member } from '../../database/schema/auth'
import { buildPermissionCatalog, allPermissionKeys } from '../../../shared/access/catalog'
import { ROLE_PRESETS, ROLE_PRESET_BY_KEY } from '../../../shared/access/role-presets'

export async function seedRbac(): Promise<{ permissions: number; roles: number; grants: number }> {
  const catalog = buildPermissionCatalog()
  const validKeys = allPermissionKeys()

  // 1. Upsert permission catalog.
  let permCount = 0
  for (const p of catalog) {
    await db
      .insert(permission)
      .values({
        key: p.key,
        resource: p.resource,
        action: p.action,
        fieldSet: p.fieldSet,
        uiLevel: p.uiLevel,
        riskLevel: p.riskLevel,
        category: p.category,
        labelRu: p.labelRu,
        labelEn: p.labelEn,
      })
      .onConflictDoUpdate({
        target: permission.key,
        set: {
          resource: p.resource,
          action: p.action,
          fieldSet: p.fieldSet,
          uiLevel: p.uiLevel,
          riskLevel: p.riskLevel,
          category: p.category,
          labelRu: p.labelRu,
          labelEn: p.labelEn,
        },
      })
    permCount++
  }

  // 2. Upsert system preset roles + their grants.
  let roleCount = 0
  let grantCount = 0
  for (const preset of ROLE_PRESETS) {
    // Find existing system role by key.
    const existing = await db
      .select({ id: role.id })
      .from(role)
      .where(and(eq(role.key, preset.key), isNull(role.organizationId), eq(role.isSystem, true)))
      .limit(1)

    let roleId: string
    if (existing.length > 0) {
      roleId = existing[0].id
      await db
        .update(role)
        .set({
          name: preset.nameRu,
          description: preset.descriptionRu,
          defaultScope: preset.defaultScope,
          isAssignable: preset.isAssignable,
          sortOrder: preset.sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(role.id, roleId))
    }
    else {
      const [inserted] = await db
        .insert(role)
        .values({
          organizationId: null,
          key: preset.key,
          name: preset.nameRu,
          description: preset.descriptionRu,
          isSystem: true,
          isAssignable: preset.isAssignable,
          defaultScope: preset.defaultScope,
          sortOrder: preset.sortOrder,
        })
        .returning({ id: role.id })
      roleId = inserted.id
    }
    roleCount++

    // Grant capabilities (only valid, catalog-known keys). Add missing only.
    const desired = preset.capabilities.filter((k) => validKeys.has(k))
    const current = await db
      .select({ permission: rolePermission.permission })
      .from(rolePermission)
      .where(eq(rolePermission.roleId, roleId))
    const currentSet = new Set(current.map((r) => r.permission))
    const toAdd = desired.filter((k) => !currentSet.has(k))
    if (toAdd.length > 0) {
      await db
        .insert(rolePermission)
        .values(toAdd.map((k) => ({ roleId, permission: k })))
        .onConflictDoNothing()
      grantCount += toAdd.length
    }
  }

  void inArray // reserved for future bulk ops
  return { permissions: permCount, roles: roleCount, grants: grantCount }
}

/**
 * Backfill member_role + member_scope for EXISTING members from member.role.
 * Runs after seedRbac() (system preset roles must exist). Idempotent:
 * only inserts assignments/scopes that are missing. Safe to run every boot.
 *
 * This complements the lazy self-heal in getActorContext(): it covers members
 * who may never hit an authed request (e.g. suspended), giving a consistent DB.
 */
export async function backfillMemberRbac(): Promise<{ roles: number; scopes: number }> {
  // Map system preset role key → role id.
  const systemRoles = await db
    .select({ id: role.id, key: role.key })
    .from(role)
    .where(and(isNull(role.organizationId), eq(role.isSystem, true)))
  const roleIdByKey = new Map<string, string>()
  for (const r of systemRoles) if (r.key) roleIdByKey.set(r.key, r.id)

  // ── §A2 migration: member default scope assigned → org (idempotent) ──
  // Existing 'member' recruiters were scoped to 'assigned' by the old default;
  // the model now grants them org-wide visibility (help each other). Only touch
  // rows still on the OLD default 'assigned' with no explicit dept/job narrowing.
  try {
    const migrated = await db.execute<{ member_id: string }>(sql`
      UPDATE member_scope ms SET scope_type = 'org', updated_at = now()
      FROM member m
      WHERE ms.member_id = m.id
        AND m.role = 'member'
        AND ms.scope_type = 'assigned'
        AND coalesce(array_length(ms.department_ids, 1), 0) = 0
        AND coalesce(array_length(ms.job_ids, 1), 0) = 0
      RETURNING ms.member_id
    `)
    if (migrated.length > 0) {
      await db.execute(sql`
        UPDATE member SET permissions_version = permissions_version + 1
        WHERE id IN ${migrated.map((r) => r.member_id)}
      `)
      console.log(`[Reqcore] §A2: migrated ${migrated.length} member(s) scope assigned→org`)
    }
  }
  catch (err) {
    console.error('[Reqcore] §A2 member scope migration failed (non-fatal):', err)
  }

  // ── §8 migration: junior_recruiter → external_recruiter (idempotent) ──
  // Rename members' denormalized role, re-point their member_role to the new
  // preset, and retire the stale junior_recruiter role row (keep row for FK
  // safety, but hide from pickers).
  const externalRoleId = roleIdByKey.get('external_recruiter')
  if (externalRoleId) {
    const juniorRow = systemRoles.find((r) => r.key === 'junior_recruiter')
    // 1. member.role text
    await db.update(member).set({ role: 'external_recruiter' }).where(eq(member.role, 'junior_recruiter'))
    // 2. member_role rows pointing at the stale junior role → external
    if (juniorRow) {
      await db.update(memberRole).set({ roleId: externalRoleId }).where(eq(memberRole.roleId, juniorRow.id)).catch(() => {})
      // 3. retire stale role row (hide from assignable list)
      await db.update(role).set({ isAssignable: false, isSystem: false, key: 'junior_recruiter_deprecated' }).where(eq(role.id, juniorRow.id)).catch(() => {})
    }
  }

  // Members lacking a member_role assignment.
  const membersNeedingRole = await db
    .select({ id: member.id, organizationId: member.organizationId, role: member.role })
    .from(member)
    .leftJoin(memberRole, eq(memberRole.memberId, member.id))
    .where(sql`${memberRole.memberId} IS NULL`)

  let roleCount = 0
  for (const m of membersNeedingRole) {
    const roleId = roleIdByKey.get(m.role)
    if (!roleId) continue // unknown role key → skip (lazy path / manual fix)
    await db
      .insert(memberRole)
      .values({ memberId: m.id, roleId, organizationId: m.organizationId, isPrimary: true })
      .onConflictDoNothing()
    roleCount++
  }

  // Members lacking a member_scope row.
  const membersNeedingScope = await db
    .select({ id: member.id, organizationId: member.organizationId, role: member.role })
    .from(member)
    .leftJoin(memberScope, eq(memberScope.memberId, member.id))
    .where(sql`${memberScope.memberId} IS NULL`)

  let scopeCount = 0
  for (const m of membersNeedingScope) {
    const scopeType = ROLE_PRESET_BY_KEY[m.role]?.defaultScope ?? 'assigned'
    await db
      .insert(memberScope)
      .values({ memberId: m.id, organizationId: m.organizationId, scopeType })
      .onConflictDoNothing({ target: memberScope.memberId })
    scopeCount++
  }

  return { roles: roleCount, scopes: scopeCount }
}
