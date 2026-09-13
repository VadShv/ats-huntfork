import { z } from 'zod'
import { and, eq, isNull, or } from 'drizzle-orm'
import { role, rolePermission } from '../../../database/schema/rbac'

const paramsSchema = z.object({ roleId: z.string().min(1) })

/**
 * GET /api/access/roles/:roleId
 * A role's details + its granted permission keys for the matrix editor.
 * Editable = org-custom role (not is_system). Owner/admin only.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { roleId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const [r] = await db.select({
    id: role.id, key: role.key, name: role.name, description: role.description,
    isSystem: role.isSystem, isAssignable: role.isAssignable, defaultScope: role.defaultScope,
    organizationId: role.organizationId,
  }).from(role)
    .where(and(eq(role.id, roleId), or(isNull(role.organizationId), eq(role.organizationId, orgId))))
    .limit(1)
  if (!r) throw createError({ statusCode: 404, statusMessage: 'Роль не найдена' })

  const perms = (await db.select({ permission: rolePermission.permission }).from(rolePermission)
    .where(eq(rolePermission.roleId, roleId))).map((p) => p.permission)

  return {
    ...r,
    // owner/admin are never editable; system presets are read-only (clone to edit).
    editable: !r.isSystem && r.organizationId === orgId,
    permissions: perms,
  }
})
