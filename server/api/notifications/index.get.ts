import { and, desc, eq, isNull } from 'drizzle-orm'
import { notification, applicationComment } from '../../database/schema/app'
import { user } from '../../database/schema/auth'
import { z } from 'zod'

const notificationListSchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  unread: z.coerce.boolean().optional(),
})

/**
 * GET /api/notifications
 * Returns the current user's notifications across the org (newest first).
 * Supports ?unread=true to filter unread only, plus pagination.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'Нет активной организации' })

  const query = await getValidatedQuery(event, notificationListSchema.parse)
  const offset = (query.page - 1) * query.limit

  const baseWhere = query.unread
    ? and(eq(notification.userId, userId), eq(notification.organizationId, orgId), isNull(notification.readAt))
    : and(eq(notification.userId, userId), eq(notification.organizationId, orgId))

  const rows = await db
    .select({
      id:           notification.id,
      type:         notification.type,
      entityType:   notification.entityType,
      entityId:     notification.entityId,
      commentId:    notification.commentId,
      readAt:       notification.readAt,
      createdAt:    notification.createdAt,
      actorUserId:  notification.actorUserId,
      actorName:    user.name,
      actorImage:   user.image,
      commentBody:  applicationComment.body,
      applicationId: applicationComment.applicationId,
    })
    .from(notification)
    .leftJoin(user, eq(user.id, notification.actorUserId))
    .leftJoin(applicationComment, eq(applicationComment.id, notification.commentId))
    .where(baseWhere)
    .orderBy(desc(notification.createdAt))
    .limit(query.limit)
    .offset(offset)

  const unread = await db.$count(
    notification,
    and(
      eq(notification.userId, userId),
      eq(notification.organizationId, orgId),
      isNull(notification.readAt),
    ),
  )

  return { data: rows, page: query.page, limit: query.limit, unread }
})
