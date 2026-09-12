import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { member, user } from '../../../database/schema/auth'
import { recordActivity } from '../../../utils/recordActivity'

const bodySchema = z.object({ memberId: z.string().min(1) })

/**
 * POST /api/access/view-as/start
 * Enter read-only "View as" mode for a target member. Only owner/admin may
 * impersonate. Sets a short-lived signed cookie consumed by getActorContext,
 * which rebuilds the actor AS the target with isViewAs=true (writes denied
 * server-side by can()).
 *
 * The cookie ALONE grants nothing — getActorContext re-verifies on every request
 * that the real session user is owner/admin before honoring it.
 */
export default defineEventHandler(async (event) => {
  // Must be owner/admin (member:update is owner/admin-only in presets).
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { memberId } = await readValidatedBody(event, bodySchema.parse)

  // Target must be a real member of this org.
  const [target] = await db
    .select({ id: member.id, userId: member.userId, role: member.role, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
    .limit(1)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Участник не найден' })
  }
  if (target.userId === session.user.id) {
    throw createError({ statusCode: 400, statusMessage: 'Нельзя смотреть от своего имени' })
  }

  setCookie(event, 'access_view_as', memberId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 30, // 30 minutes
  })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'member',
    resourceId: memberId,
    metadata: { event: 'view_as_started', targetName: target.name, targetRole: target.role },
  })

  return { ok: true, memberId, targetName: target.name }
})
