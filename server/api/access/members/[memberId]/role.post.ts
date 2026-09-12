import { z } from 'zod'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { member } from '../../../../database/schema/auth'
import { role as roleTable } from '../../../../database/schema/rbac'
import { syncMemberRoleChange } from '../../../../utils/access/memberRbacSync'
import { recordActivity } from '../../../../utils/recordActivity'

const paramsSchema = z.object({ memberId: z.string().min(1) })
const bodySchema = z.object({ roleKey: z.string().min(1) })

/**
 * POST /api/access/members/:memberId/role
 * Assign a system-preset (or org-custom) role to a member — including roles the
 * Better Auth client can't set (lead_recruiter, external_recruiter, hiring_manager).
 * Updates member.role (denormalized primary) + member_role + member_scope and
 * bumps permissions_version. Owner/admin only.
 *
 * Guards: cannot change the last owner; cannot assign 'owner' here (ownership
 * transfer is a separate flow).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { memberId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { roleKey } = await readValidatedBody(event, bodySchema.parse)

  if (roleKey === 'owner') {
    throw createError({ statusCode: 400, statusMessage: 'Передача владения выполняется отдельно' })
  }

  // Validate the target role exists and is assignable in this org.
  const [targetRole] = await db
    .select({ id: roleTable.id, key: roleTable.key, isAssignable: roleTable.isAssignable })
    .from(roleTable)
    .where(and(
      eq(roleTable.key, roleKey),
      or(isNull(roleTable.organizationId), eq(roleTable.organizationId, orgId)),
    ))
    .limit(1)
  if (!targetRole || !targetRole.isAssignable) {
    throw createError({ statusCode: 400, statusMessage: 'Роль недоступна для назначения' })
  }

  // Load the target member in this org.
  const [target] = await db
    .select({ id: member.id, role: member.role, userId: member.userId })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
    .limit(1)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Участник не найден' })
  }

  // Don't demote the last owner.
  if (target.role === 'owner') {
    const [{ owners }] = await db
      .select({ owners: sql<number>`count(*)::int` })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.role, 'owner')))
    if (owners <= 1) {
      throw createError({ statusCode: 400, statusMessage: 'Нельзя снять последнего владельца' })
    }
  }

  // Update denormalized primary role, then project into RBAC v2 tables.
  await db
    .update(member)
    .set({ role: roleKey })
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
  await syncMemberRoleChange(memberId, orgId, roleKey)

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'member',
    resourceId: memberId,
    metadata: { field: 'role', from: target.role, to: roleKey },
  })

  return { ok: true, memberId, roleKey }
})
