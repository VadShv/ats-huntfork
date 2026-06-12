import { and, eq } from 'drizzle-orm'
import {
  application,
  applicationComment,
  commentReaction,
} from '../../../../../../database/schema/app'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Неверный id отклика'),
  commentId: z.string().min(1),
  emoji: z.string().min(1),
})

/**
 * DELETE /api/applications/:id/comments/:commentId/reactions/:emoji
 *
 * Remove the current user's reaction with the given emoji from this comment.
 * Idempotent — succeeds even if no such reaction exists.
 *
 * Emoji is URL-decoded by Nitro; passes through to the WHERE clause.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id, commentId, emoji } = await getValidatedRouterParams(event, paramsSchema.parse)

  // ── verify application + comment exist & belong to the org ──
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
    columns: { id: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Комментарий не найден' })

  await db
    .delete(commentReaction)
    .where(
      and(
        eq(commentReaction.commentId, commentId),
        eq(commentReaction.userId, userId),
        eq(commentReaction.emoji, emoji),
      ),
    )

  setResponseStatus(event, 204)
  return null
})
