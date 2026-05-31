import { eq, and } from 'drizzle-orm'
import * as schema from '../../database/schema'

/**
 * GET /api/members/pending
 * Returns all pending members in the current organization.
 * Requires member:update permission (owner/admin only).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId

  const rows = await db
    .select({
      id: schema.member.id,
      userId: schema.member.userId,
      role: schema.member.role,
      status: schema.member.status,
      createdAt: schema.member.createdAt,
      userName: schema.user.name,
      userEmail: schema.user.email,
      userImage: schema.user.image,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(
      and(
        eq(schema.member.organizationId, orgId),
        eq(schema.member.status, 'pending'),
      ),
    )
    .orderBy(schema.member.createdAt)

  return rows
})
