import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { role } from '../../database/schema/rbac'

/**
 * GET /api/access/roles
 * Assignable roles for the org: system presets (organization_id NULL) + any
 * org-custom roles. Used by the access-management UI role picker.
 * Owner/admin only (member:update).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId

  const rows = await db
    .select({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      isAssignable: role.isAssignable,
      defaultScope: role.defaultScope,
      color: role.color,
      sortOrder: role.sortOrder,
      organizationId: role.organizationId,
    })
    .from(role)
    .where(or(isNull(role.organizationId), eq(role.organizationId, orgId)))
    .orderBy(asc(role.sortOrder), asc(role.name))

  return rows.filter((r) => r.isAssignable)
})
