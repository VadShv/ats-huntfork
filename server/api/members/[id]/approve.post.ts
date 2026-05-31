import { eq, and } from 'drizzle-orm'
import * as schema from '../../../database/schema'

/**
 * POST /api/members/[id]/approve
 * Approves a pending member, setting status to 'active'.
 * Only owners/admins (member:update permission) may approve.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const memberId = getRouterParam(event, 'id')

  if (!memberId) {
    throw createError({ statusCode: 400, statusMessage: 'Member ID is required' })
  }

  // Verify the member belongs to the current org and is pending
  const [existing] = await db
    .select({ id: schema.member.id, status: schema.member.status })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.id, memberId),
        eq(schema.member.organizationId, orgId),
      ),
    )
    .limit(1)

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found' })
  }

  if (existing.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'Member is not in pending status' })
  }

  await db
    .update(schema.member)
    .set({
      status: 'active',
      approvedBy: session.user.id,
      approvedAt: new Date(),
    })
    .where(eq(schema.member.id, memberId))

  return { success: true }
})
