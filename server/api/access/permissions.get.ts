import { asc } from 'drizzle-orm'
import { permission } from '../../database/schema/rbac'

/**
 * GET /api/access/permissions
 * The permission catalog (grouped by category on the client) for the per-user
 * overrides / role-matrix UI. Owner/admin only.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { member: ['update'] })

  const rows = await db
    .select({
      key: permission.key,
      resource: permission.resource,
      action: permission.action,
      fieldSet: permission.fieldSet,
      uiLevel: permission.uiLevel,
      riskLevel: permission.riskLevel,
      category: permission.category,
      labelRu: permission.labelRu,
      labelEn: permission.labelEn,
    })
    .from(permission)
    .orderBy(asc(permission.category), asc(permission.resource), asc(permission.action))

  return rows
})
