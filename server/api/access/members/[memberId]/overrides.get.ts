import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { member } from '../../../../database/schema/auth'
import { memberPermissionOverride } from '../../../../database/schema/rbac'

const paramsSchema = z.object({ memberId: z.string().min(1) })

/**
 * GET /api/access/members/:memberId/overrides
 * Per-user permission overrides (allow/deny). Owner/admin only.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { memberId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const [target] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
    .limit(1)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Участник не найден' })
  }

  const rows = await db
    .select({
      permission: memberPermissionOverride.permission,
      effect: memberPermissionOverride.effect,
      reason: memberPermissionOverride.reason,
      expiresAt: memberPermissionOverride.expiresAt,
    })
    .from(memberPermissionOverride)
    .where(eq(memberPermissionOverride.memberId, memberId))

  return rows
})
