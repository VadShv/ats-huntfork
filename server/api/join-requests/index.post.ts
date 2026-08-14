import { eq, and, gt } from 'drizzle-orm'
import { joinRequest, member, organization } from '../../database/schema'
import { createJoinRequestSchema } from '../../utils/schemas/joinRequest'

/**
 * POST /api/join-requests
 * Submit a request to join an organization.
 * Does NOT require an active org (the user may not have one).
 *
 * Security:
 *   - Requires authentication
 *   - Only one pending request per user per org
 *   - Cannot request to join an org you're already a member of
 *   - Cannot use a non-existent org ID
 */
export default defineEventHandler(async (event) => {
  // ── Authenticate (no org required) ──
  const session = await auth.api.getSession({ headers: event.headers })

  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Требуется вход' })
  }

  const body = await readValidatedBody(event, createJoinRequestSchema.parse)

  // ── Verify the organization exists ──
  const [org] = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.id, body.organizationId))
    .limit(1)

  if (!org) {
    throw createError({ statusCode: 404, statusMessage: 'Организация не найдена' })
  }

  // ── Check if already a member ──
  const [existingMember] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, body.organizationId),
      ),
    )
    .limit(1)

  if (existingMember) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Вы уже состоите в этой организации',
    })
  }

  // ── Check for existing pending request ──
  const [existingRequest] = await db
    .select({ id: joinRequest.id })
    .from(joinRequest)
    .where(
      and(
        eq(joinRequest.userId, session.user.id),
        eq(joinRequest.organizationId, body.organizationId),
        eq(joinRequest.status, 'pending'),
      ),
    )
    .limit(1)

  if (existingRequest) {
    throw createError({
      statusCode: 409,
      statusMessage: 'У вас уже есть ожидающий запрос на вступление в эту организацию',
    })
  }

  // ── Check for recently rejected request (7-day cooldown) ──
  const [recentRejection] = await db
    .select({ id: joinRequest.id })
    .from(joinRequest)
    .where(
      and(
        eq(joinRequest.userId, session.user.id),
        eq(joinRequest.organizationId, body.organizationId),
        eq(joinRequest.status, 'rejected'),
        gt(joinRequest.reviewedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
      ),
    )
    .limit(1)

  if (recentRejection) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Предыдущий запрос был недавно отклонён. Подождите перед повторной подачей',
    })
  }

  // ── Create the join request ──
  const [created] = await db
    .insert(joinRequest)
    .values({
      userId: session.user.id,
      organizationId: body.organizationId,
      message: body.message?.trim() || null,
    })
    .returning({
      id: joinRequest.id,
      status: joinRequest.status,
      createdAt: joinRequest.createdAt,
    })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось создать запрос на вступление' })
  }

  setResponseStatus(event, 201)
  return {
    ...created,
    organizationName: org.name,
  }
})
