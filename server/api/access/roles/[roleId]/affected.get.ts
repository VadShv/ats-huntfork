import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { member, user } from '../../../../database/schema/auth'
import { memberRole } from '../../../../database/schema/rbac'

const paramsSchema = z.object({ roleId: z.string().min(1) })

/**
 * GET /api/access/roles/:roleId/affected
 * Members who currently hold this role — for the "diff before save" panel
 * ("затронуто участников: N — …"). Owner/admin only.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { roleId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const rows = await db
    .select({ memberId: memberRole.memberId, name: user.name, email: user.email })
    .from(memberRole)
    .innerJoin(member, eq(member.id, memberRole.memberId))
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(memberRole.roleId, roleId), eq(memberRole.organizationId, orgId)))
    .orderBy(user.name)

  return { count: rows.length, members: rows }
})
