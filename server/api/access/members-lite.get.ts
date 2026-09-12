import { and, eq } from 'drizzle-orm'
import { member, user } from '../../database/schema/auth'

/**
 * GET /api/access/members-lite
 * Lightweight active-member list ({ memberId, userId, name, email }) for pickers
 * (e.g. HRBP assignment in org-structure). Owner/admin only (member:update).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId

  const rows = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, orgId), eq(member.status, 'active')))
    .orderBy(user.name)

  return rows
})
