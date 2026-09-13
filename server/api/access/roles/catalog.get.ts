import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { role, memberRole } from '../../../database/schema/rbac'

/**
 * GET /api/access/roles/catalog
 * All roles for the Roles editor tab: system presets + org-custom, each with a
 * member count and an `editable` flag. Owner/admin only.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId

  const roles = await db.select({
    id: role.id, key: role.key, name: role.name, description: role.description,
    isSystem: role.isSystem, isAssignable: role.isAssignable, defaultScope: role.defaultScope,
    color: role.color, sortOrder: role.sortOrder, organizationId: role.organizationId,
  }).from(role)
    .where(or(isNull(role.organizationId), eq(role.organizationId, orgId)))
    .orderBy(asc(role.sortOrder), asc(role.name))

  // Member counts per role in this org.
  const counts = await db.select({ roleId: memberRole.roleId, cnt: sql<number>`count(*)::int` })
    .from(memberRole).where(eq(memberRole.organizationId, orgId)).groupBy(memberRole.roleId)
  const countMap = new Map(counts.map((c) => [c.roleId, c.cnt]))

  return roles
    // hide the deprecated junior role from the editor
    .filter((r) => r.key !== 'junior_recruiter' && !(r.key ?? '').endsWith('_deprecated'))
    .map((r) => ({
      ...r,
      memberCount: countMap.get(r.id) ?? 0,
      editable: !r.isSystem && r.organizationId === orgId,
    }))
})
