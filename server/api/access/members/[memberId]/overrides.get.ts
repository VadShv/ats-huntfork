import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { member } from '../../../../database/schema/auth'
import { memberPermissionOverride } from '../../../../database/schema/rbac'
import { resolveMemberCapabilities } from '../../../../utils/access/permissionResolver'

const paramsSchema = z.object({ memberId: z.string().min(1) })

/**
 * GET /api/access/members/:memberId/overrides
 * Per-user permission overrides (allow/deny) AND the member's role-granted
 * capabilities, so the UI can show the base role effect ("по роли ✓/✗", §9)
 * next to each override. Owner/admin only.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { memberId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const [target] = await db
    .select({ id: member.id, role: member.role, permissionsVersion: member.permissionsVersion })
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

  // Role-granted capabilities (WITHOUT overrides) → base effect for the ✓/✗ badge.
  const roleCaps = await resolveMemberCapabilities(memberId, orgId, target.role, target.permissionsVersion)

  return {
    overrides: rows,
    roleCapabilities: Array.from(roleCaps),
  }
})
