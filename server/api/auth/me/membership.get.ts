import { eq, and } from 'drizzle-orm'
import * as schema from '../../../database/schema'

/**
 * GET /api/auth/me/membership
 * Returns the current user's member record in their active organization,
 * including the moderation status field.
 * Returns null if the user has no session or no active organization.
 */
export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })

  if (!session) {
    return null
  }

  const activeOrganizationId = (session.session as { activeOrganizationId?: string }).activeOrganizationId

  if (!activeOrganizationId) {
    return null
  }

  const rows = await db
    .select({
      id: schema.member.id,
      userId: schema.member.userId,
      organizationId: schema.member.organizationId,
      role: schema.member.role,
      status: schema.member.status,
      createdAt: schema.member.createdAt,
      // Спринт 20: флаги НМ для глобального middleware/UI
      mustChangePassword: schema.member.mustChangePassword,
      hmCanViewSalary: schema.member.hmCanViewSalary,
    })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, session.user.id),
        eq(schema.member.organizationId, activeOrganizationId),
      ),
    )
    .limit(1)

  return rows[0] ?? null
})
