/**
 * Notification helpers for the collaboration thread.
 *
 * Notifications are in-app only (no email/push in MVP).
 * Dedup-rules:
 *   - One 'mention' per (userId, commentId).
 *   - One 'new_comment_on_watched' per (userId, commentId).
 *   - Author никогда не получает уведомление о своём же комментарии.
 */

import { and, eq } from 'drizzle-orm'
import { notification } from '../../database/schema/app'

export type NotificationType = 'mention' | 'reply' | 'reaction' | 'new_comment_on_watched'

export interface CreateNotificationParams {
  organizationId: string
  userId: string
  type: NotificationType
  entityType: 'application' | 'comment'
  entityId: string
  commentId?: string
  actorUserId: string
}

export async function createNotification(
  database: typeof db,
  params: CreateNotificationParams,
): Promise<void> {
  // Никогда не нотифицируем самого себя
  if (params.actorUserId === params.userId) return

  // Дедуп для mention/new_comment_on_watched по (userId, commentId, type)
  if (params.commentId && (params.type === 'mention' || params.type === 'new_comment_on_watched' || params.type === 'reply')) {
    const exists = await database
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.userId, params.userId),
          eq(notification.commentId, params.commentId),
          eq(notification.type, params.type),
        ),
      )
      .limit(1)
    if (exists.length > 0) return
  }

  await database.insert(notification).values({
    organizationId: params.organizationId,
    userId: params.userId,
    type: params.type,
    entityType: params.entityType,
    entityId: params.entityId,
    commentId: params.commentId ?? null,
    actorUserId: params.actorUserId,
  })
}

/**
 * Bulk variant — batch INSERT for "notify all watchers" scenarios.
 * Does *not* dedup (caller must pre-filter), but skips self-notify automatically.
 */
export async function createNotificationsBulk(
  database: typeof db,
  items: CreateNotificationParams[],
): Promise<void> {
  const filtered = items.filter(i => i.actorUserId !== i.userId)
  if (filtered.length === 0) return
  await database.insert(notification).values(
    filtered.map(p => ({
      organizationId: p.organizationId,
      userId: p.userId,
      type: p.type,
      entityType: p.entityType,
      entityId: p.entityId,
      commentId: p.commentId ?? null,
      actorUserId: p.actorUserId,
    })),
  )
}
