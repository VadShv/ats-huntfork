import { eq, and } from 'drizzle-orm'
import * as schema from '../../../database/schema'

/**
 * POST /api/members/[id]/reject
 * Rejects a pending member, setting status to 'rejected'.
 * Only owners/admins (member:update permission) may reject.
 * Accepts optional body: { reason: string }
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const memberId = getRouterParam(event, 'id')

  if (!memberId) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан ID участника' })
  }

  const body = await readBody(event).catch(() => ({})) as { reason?: string }

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
    throw createError({ statusCode: 404, statusMessage: 'Участник не найден' })
  }

  if (existing.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'Участник не ожидает подтверждения' })
  }

  await db
    .update(schema.member)
    .set({
      status: 'rejected',
      rejectedReason: body.reason ?? null,
    })
    .where(eq(schema.member.id, memberId))

  return { success: true }
})
