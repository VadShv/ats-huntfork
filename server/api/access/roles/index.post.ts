import { z } from 'zod'
import { and, eq, isNull, or } from 'drizzle-orm'
import { role, rolePermission, rolePermissionVersion } from '../../../database/schema/rbac'
import { recordActivity } from '../../../utils/recordActivity'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  /** Optional source role KEY to clone permissions/scope from. */
  cloneFromKey: z.string().min(1).optional(),
  description: z.string().max(500).optional(),
})

/**
 * POST /api/access/roles
 * Create a new ORG-CUSTOM role, optionally cloning permissions + default scope
 * from an existing (system or custom) role. Custom roles are editable in the
 * matrix; system presets stay read-only. Owner/admin only.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  // Unique name within the org.
  const [dup] = await db.select({ id: role.id }).from(role)
    .where(and(eq(role.organizationId, orgId), eq(role.name, body.name))).limit(1)
  if (dup) throw createError({ statusCode: 409, statusMessage: 'Роль с таким названием уже существует' })

  let sourcePerms: string[] = []
  let defaultScope = 'assigned'
  if (body.cloneFromKey) {
    const [src] = await db.select({ id: role.id, defaultScope: role.defaultScope }).from(role)
      .where(and(eq(role.key, body.cloneFromKey), or(isNull(role.organizationId), eq(role.organizationId, orgId))))
      .limit(1)
    if (!src) throw createError({ statusCode: 400, statusMessage: 'Исходная роль не найдена' })
    defaultScope = src.defaultScope
    sourcePerms = (await db.select({ permission: rolePermission.permission }).from(rolePermission)
      .where(eq(rolePermission.roleId, src.id))).map((r) => r.permission)
  }

  const [created] = await db.insert(role).values({
    organizationId: orgId,
    key: null, // custom roles have no stable preset key
    name: body.name,
    description: body.description ?? null,
    isSystem: false,
    isAssignable: true,
    defaultScope,
    sortOrder: 500,
  }).returning({ id: role.id })

  if (sourcePerms.length > 0) {
    await db.insert(rolePermission).values(sourcePerms.map((p) => ({ roleId: created.id, permission: p })))
  }

  // Initial version snapshot.
  await db.insert(rolePermissionVersion).values({
    roleId: created.id,
    snapshot: sourcePerms,
    changedBy: session.user.id,
    changeNote: body.cloneFromKey ? `Клонирована из ${body.cloneFromKey}` : 'Создана',
  })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'role_created',
    resourceType: 'role',
    resourceId: created.id,
    riskLevel: 1,
    metadata: { name: body.name, cloneFrom: body.cloneFromKey ?? null },
  })

  return { id: created.id, name: body.name }
})
