import { and, eq, inArray, notInArray } from 'drizzle-orm'
import {
  application,
  applicationComment,
  commentMention,
} from '../../../../database/schema/app'
import { user } from '../../../../database/schema/auth'
import {
  applicationCommentIdParamSchema,
  updateApplicationCommentSchema,
} from '../../../../utils/schemas/applicationComment'
import { parseMentionTokens, resolveMentions } from '../../../../utils/comments/mention-parser'
import { ensureWatcher } from '../../../../utils/comments/ensure-watcher'
import { renderMarkdown } from '../../../../utils/comments/sanitize'
import { createNotification } from '../../../../utils/comments/notifications'

/**
 * PATCH /api/applications/:id/comments/:commentId
 *
 * Edit own comment. Re-renders body_html, diffs mentions:
 *   - new mentions → INSERT mention + notify + ensureWatcher
 *   - removed mentions → kept as-is (no destructive cleanup)
 *
 * Sets `edited_at` and `updated_at`.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id, commentId } = await getValidatedRouterParams(
    event,
    applicationCommentIdParamSchema.parse,
  )
  const body = await readValidatedBody(event, updateApplicationCommentSchema.parse)

  // ── 1. Verify application + comment ──
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

  if (existing.authorUserId !== userId) {
    throw createError({ statusCode: 403, statusMessage: 'Можно редактировать только свои комментарии' })
  }

  const bodyHtml = renderMarkdown(body.body)
  const now = new Date()

  // ── 2. UPDATE ──
  const [updated] = await db
    .update(applicationComment)
    .set({ body: body.body, bodyHtml, editedAt: now, updatedAt: now })
    .where(eq(applicationComment.id, commentId))
    .returning({
      id: applicationComment.id,
      body: applicationComment.body,
      bodyHtml: applicationComment.bodyHtml,
      isInternal: applicationComment.isInternal,
      parentCommentId: applicationComment.parentCommentId,
      editedAt: applicationComment.editedAt,
      createdAt: applicationComment.createdAt,
      updatedAt: applicationComment.updatedAt,
    })

  // ── 3. Diff mentions ──
  const tokens = parseMentionTokens(body.body)
  const newMentionIds = await resolveMentions(db, orgId, tokens)

  const oldMentions = await db
    .select({ userId: commentMention.mentionedUserId })
    .from(commentMention)
    .where(eq(commentMention.commentId, commentId))

  const oldSet = new Set(oldMentions.map(m => m.userId))
  const added = newMentionIds.filter(uid => !oldSet.has(uid))

  if (added.length > 0) {
    await db
      .insert(commentMention)
      .values(added.map(uid => ({ commentId, mentionedUserId: uid })))
      .onConflictDoNothing()

    for (const uid of added) {
      await ensureWatcher(db, {
        organizationId: orgId,
        applicationId: id,
        userId: uid,
        source: 'auto_mention',
      })
      await createNotification(db, {
        organizationId: orgId,
        userId: uid,
        type: 'mention',
        entityType: 'comment',
        entityId: commentId,
        commentId,
        actorUserId: userId,
      })
    }
  }

  const author = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { id: true, name: true, email: true, image: true },
  })

  return {
    ...updated,
    author,
  }
})
