import { and, eq } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../../../utils/access/scope'
import {
  application,
  applicationComment,
  commentReaction,
} from '../../../../../../database/schema/app'
import { z } from 'zod'
import { createNotification } from '../../../../../../utils/comments/notifications'
import { notifyThreadChanged } from '../../../../../../utils/comments/threadBus'
import { ALLOWED_REACTION_EMOJI, getCommentReactions } from '../../../../../../utils/comments/reactions'

const paramsSchema = z.object({
  id: z.string().uuid('Неверный id отклика'),
  commentId: z.string().min(1),
})

// Curated set of emoji we accept — keeps storage normalized & UI consistent.
// Нормализуем к NFC: «❤️» может прийти в другой кодовой форме с некоторых клавиатур.
const bodySchema = z.object({
  emoji: z.string().transform(e => e.normalize('NFC')).refine(
    (e) => (ALLOWED_REACTION_EMOJI as readonly string[]).includes(e),
    { message: 'Недопустимая эмодзи-реакция' },
  ),
})

/**
 * POST /api/applications/:id/comments/:commentId/reactions
 *
 * Add a reaction to a comment. Idempotent via UNIQUE (comment_id, user_id, emoji).
 * Notifies the comment author (unless self-reacting or the comment has no user author —
 * hh-импорт/система). Возвращает `{ reaction, reactions }`: вставленную строку и актуальный
 * сгруппированный список реакций комментария (клиент подменяет им оптимистичное состояние).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id, commentId } = await getValidatedRouterParams(event, paramsSchema.parse)
  await requireApplicationInScope(event, id as string, orgId as string)
  const { emoji } = await readValidatedBody(event, bodySchema.parse)

  // ── verify application + comment ──
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  const existing = await db.query.applicationComment.findFirst({
    where: and(
      eq(applicationComment.id, commentId),
      eq(applicationComment.applicationId, id),
      eq(applicationComment.organizationId, orgId),
    ),
    columns: { id: true, authorUserId: true, deletedAt: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Комментарий не найден' })
  if (existing.deletedAt) {
    throw createError({ statusCode: 410, statusMessage: 'Комментарий удалён' })
  }

  // ── insert reaction (idempotent) ──
  const [inserted] = await db
    .insert(commentReaction)
    .values({ commentId, userId, emoji })
    .onConflictDoNothing()
    .returning({
      id: commentReaction.id,
      commentId: commentReaction.commentId,
      userId: commentReaction.userId,
      emoji: commentReaction.emoji,
      createdAt: commentReaction.createdAt,
    })

  // If inserted is undefined → reaction already exists; we still return success
  // with the current grouped list.
  if (!inserted) {
    const reactions = await getCommentReactions(db, commentId, userId)
    setResponseStatus(event, 200)
    return { reaction: { commentId, userId, emoji }, reactions }
  }

  // ── notify the comment author (not self; у hh-импорта/системных сообщений автора нет) ──
  if (existing.authorUserId && existing.authorUserId !== userId) {
    try {
      await createNotification(db, {
        organizationId: orgId,
        userId: existing.authorUserId,
        type: 'reaction',
        entityType: 'comment',
        entityId: commentId,
        commentId,
        actorUserId: userId,
      })
    } catch (e) {
      // Уведомление — побочный эффект; реакция уже сохранена, не роняем запрос.
      console.error('[reactions] notification failed', e)
    }
  }

  notifyThreadChanged(id)

  const reactions = await getCommentReactions(db, commentId, userId)
  setResponseStatus(event, 201)
  return { reaction: inserted, reactions }
})
