import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { role, memberRole } from '../../../database/schema/rbac'
import { recordActivity } from '../../../utils/recordActivity'

const paramsSchema = z.object({ roleId: z.string().min(1) })

/**
 * DELETE /api/access/roles/:roleId
 * Delete an ORG-CUSTOM role. Blocked for system presets and for roles still
 * assigned to members. Owner/admin only.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { roleId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const [r] = await db.select({ id: role.id, isSystem: role.isSystem, organizationId: role.organizationId, name: role.name })
    .from(role).where(eq(role.id, roleId)).limit(1)
  if (!r) throw createError({ statusCode: 404, statusMessage: 'Роль не найдена' })
  if (r.isSystem || r.organizationId !== orgId) {
    throw createError({ statusCode: 403, statusMessage: 'Системные роли нельзя удалить' })
  }

  const [holder] = await db.select({ memberId: memberRole.memberId }).from(memberRole)
    .where(and(eq(memberRole.roleId, roleId), eq(memberRole.organizationId, orgId))).limit(1)
  if (holder) {
    throw createError({ statusCode: 409, statusMessage: 'Роль назначена участникам — сначала переназначьте их' })
  }

  await db.delete(role).where(eq(role.id, roleId))

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'deleted',
    resourceType: 'role',
    resourceId: roleId,
    metadata: { name: r.name },
  })

  return { ok: true }
})
