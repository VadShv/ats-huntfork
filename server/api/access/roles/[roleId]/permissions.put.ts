import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { role, rolePermission, rolePermissionVersion, memberRole, permission as permissionTable } from '../../../../database/schema/rbac'
import { bumpPermissionsVersion } from '../../../../utils/access/memberRbacSync'
import { recordActivity } from '../../../../utils/recordActivity'

const paramsSchema = z.object({ roleId: z.string().min(1) })
const bodySchema = z.object({
  permissions: z.array(z.string().min(1)).max(500),
  changeNote: z.string().max(500).optional(),
})

/**
 * PUT /api/access/roles/:roleId/permissions
 * Replace an ORG-CUSTOM role's permission set. Writes a version snapshot
 * (rollback/audit) and bumps permissions_version for every member with this
 * role. System presets are read-only (403). Owner/admin only.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { roleId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  const [r] = await db.select({ id: role.id, isSystem: role.isSystem, organizationId: role.organizationId, name: role.name })
    .from(role).where(eq(role.id, roleId)).limit(1)
  if (!r) throw createError({ statusCode: 404, statusMessage: 'Роль не найдена' })
  if (r.isSystem || r.organizationId !== orgId) {
    throw createError({ statusCode: 403, statusMessage: 'Системные роли нередактируемы — клонируйте роль' })
  }

  // Validate against the catalog.
  const validKeys = new Set((await db.select({ key: permissionTable.key }).from(permissionTable)).map((p) => p.key))
  const desired = [...new Set(body.permissions)].filter((k) => validKeys.has(k))

  await db.transaction(async (tx) => {
    await tx.delete(rolePermission).where(eq(rolePermission.roleId, roleId))
    if (desired.length > 0) {
      await tx.insert(rolePermission).values(desired.map((permission) => ({ roleId, permission })))
    }
    await tx.insert(rolePermissionVersion).values({
      roleId,
      snapshot: desired,
      changedBy: session.user.id,
      changeNote: body.changeNote ?? 'Изменены права',
    })
  })

  // Bump every member holding this role so caches invalidate ≤ TTL.
  const holders = await db.select({ memberId: memberRole.memberId }).from(memberRole)
    .where(and(eq(memberRole.roleId, roleId), eq(memberRole.organizationId, orgId)))
  for (const h of holders) await bumpPermissionsVersion(h.memberId)

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'role',
    resourceId: roleId,
    metadata: { event: 'role_permissions_changed', name: r.name, count: desired.length, affected: holders.length },
  })

  return { ok: true, roleId, count: desired.length, affected: holders.length }
})
