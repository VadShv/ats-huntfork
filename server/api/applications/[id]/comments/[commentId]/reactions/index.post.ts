import { and, eq } from 'drizzle-orm'
import {
  application,
  applicationComment,
  commentReaction,
} from '../../../../../../database/schema/app'
import { z } from 'zod'
import { createNotification } from '../../../../../../utils/comments/notifications'

const paramsSchema = z.object({
  id: z.string().uuid('Неверный id отклика'),
  commentId: z.string().min(1),
})

// Curated set of emoji we accept — keeps storage normalized & UI consistent.
const ALLOWED_EMOJI = ['👍', '❤️', '🎉', '👀', '🚀', '✅', '😄', '🤔'] as const

const bodySchema = z.object({
  emoji: z.string().refine(
    (e) => (ALLOWED_EMOJI as readonly string[]).includes(e),
    { message: 'Недопустимая эмодзи-реакция' },
  ),
})

/**
 * POST /api/applications/:id/comments/:commentId/reactions
 *
 * Add a reaction to a comment. Idempotent via UNIQUE (comment_id, user_id, emoji).
 * Notifies the comment author (unless self-reacting).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id, commentId } = await getValidatedRouterParams(event, paramsSchema.parse)
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
  // with a fresh-look payload by re-fetching.
  if (!inserted) {
    const existingRow = await db.query.commentReaction.findFirst({
      where: and(
        eq(commentReaction.commentId, commentId),
        eq(commentReaction.userId, userId),
        eq(commentReaction.emoji, emoji),
      ),
    })
    setResponseStatus(event, 200)
    return existingRow ?? { commentId, userId, emoji }
  }

  // ── notify the comment author (not self) ──
  if (existing.authorUserId !== userId) {
    await createNotification(db, {
      organizationId: orgId,
      userId: existing.authorUserId,
      type: 'reaction',
      entityType: 'comment',
      entityId: commentId,
      commentId,
      actorUserId: userId,
    })
  }

  setResponseStatus(event, 201)
  return inserted
})
