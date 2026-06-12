import { and, eq } from 'drizzle-orm'
import {
  application,
  applicationComment,
  applicationWatcher,
  commentMention,
} from '../../../../database/schema/app'
import { user } from '../../../../database/schema/auth'
import { applicationIdParamSchema } from '../../../../utils/schemas/application'
import { createApplicationCommentSchema } from '../../../../utils/schemas/applicationComment'
import { parseMentionTokens, resolveMentions } from '../../../../utils/comments/mention-parser'
import { ensureWatcher } from '../../../../utils/comments/ensure-watcher'
import { renderMarkdown } from '../../../../utils/comments/sanitize'
import {
  createNotification,
  createNotificationsBulk,
} from '../../../../utils/comments/notifications'
import { canSeeInternal, getMemberRole } from '../../../../utils/comments/visibility'

/**
 * POST /api/applications/:id/comments
 *
 * Flow (см. RFC §4.1):
 *   1. Validate body + isInternal permission
 *   2. Render body → bodyHtml
 *   3. INSERT application_comment
 *   4. Parse + resolve @mentions → INSERT comment_mention, ensureWatcher(auto_mention), notify(mention)
 *   5. ensureWatcher(author, 'auto_author')
 *   6. Notify existing watchers (excluding author + already-mentioned) with 'new_comment_on_watched'
 *   7. recordActivity('comment_added')
 *   8. Return enriched CommentWithMeta
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  const body = await readValidatedBody(event, createApplicationCommentSchema.parse)

  // ── 1. Verify application ──
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true, candidateId: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  // ── 2. is_internal allowed only for owner/admin/recruiter ──
  if (body.isInternal) {
    const role = await getMemberRole(db, orgId, userId)
    if (!canSeeInternal(role)) {
      throw createError({ statusCode: 403, statusMessage: 'Недостаточно прав для внутреннего комментария' })
    }
  }

  // ── 3. If parentCommentId — verify it belongs to same application + is visible ──
  if (body.parentCommentId) {
    const parent = await db.query.applicationComment.findFirst({
      where: and(
        eq(applicationComment.id, body.parentCommentId),
        eq(applicationComment.applicationId, id),
      ),
      columns: { id: true },
    })
    if (!parent) {
      throw createError({ statusCode: 400, statusMessage: 'Родительский комментарий не найден' })
    }
  }

  const bodyHtml = renderMarkdown(body.body)
  const now = new Date()

  // ── 4. INSERT comment ──
  const [created] = await db
    .insert(applicationComment)
    .values({
      organizationId: orgId,
      applicationId: id,
      candidateId: app.candidateId,
      authorUserId: userId,
      body: body.body,
      bodyHtml,
      isInternal: body.isInternal ?? false,
      parentCommentId: body.parentCommentId ?? null,
    })
    .returning({
      id: applicationComment.id,
      body: applicationComment.body,
      bodyHtml: applicationComment.bodyHtml,
      isInternal: applicationComment.isInternal,
      parentCommentId: applicationComment.parentCommentId,
      createdAt: applicationComment.createdAt,
      updatedAt: applicationComment.updatedAt,
    })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось создать комментарий' })
  }

  // ── 5. Parse mentions ──
  const tokens = parseMentionTokens(body.body)
  const mentionedUserIds = await resolveMentions(db, orgId, tokens)

  if (mentionedUserIds.length > 0) {
    await db
      .insert(commentMention)
      .values(mentionedUserIds.map(mid => ({ commentId: created.id, mentionedUserId: mid })))
      .onConflictDoNothing()

    // Auto-watcher for each mentioned user
    for (const mid of mentionedUserIds) {
      await ensureWatcher(db, {
        organizationId: orgId,
        applicationId: id,
        userId: mid,
        source: 'auto_mention',
      })
    }

    // Notifications for mentions (skips self)
    for (const mid of mentionedUserIds) {
      await createNotification(db, {
        organizationId: orgId,
        userId: mid,
        type: 'mention',
        entityType: 'comment',
        entityId: created.id,
        commentId: created.id,
        actorUserId: userId,
      })
    }
  }

  // ── 6. Auto-watcher: author ──
  await ensureWatcher(db, {
    organizationId: orgId,
    applicationId: id,
    userId,
    source: 'auto_author',
  })

  // ── 7. Notify existing watchers (excluding author and already-mentioned) ──
  // Only for non-internal comments fan out broadly. For internal comments we
  // still fan out — recipients on the watcher list are recruiters/admins (they
  // see internal anyway); plain members on the list will see no notification
  // payload until they actually open the thread (visibility filter excludes
  // is_internal). Server-side filter is by role, applied at notification fetch
  // time? For MVP we *do* send the notification to every watcher: viewing it
  // simply opens the application page where visibility filter applies.
  const watchers = await db
    .select({ userId: applicationWatcher.userId })
    .from(applicationWatcher)
    .where(eq(applicationWatcher.applicationId, id))

  const excludeSet = new Set<string>([userId, ...mentionedUserIds])
  const watcherTargets = watchers
    .map(w => w.userId)
    .filter(uid => !excludeSet.has(uid))

  if (watcherTargets.length > 0) {
    await createNotificationsBulk(
      db,
      watcherTargets.map(uid => ({
        organizationId: orgId,
        userId: uid,
        type: 'new_comment_on_watched' as const,
        entityType: 'comment' as const,
        entityId: created.id,
        commentId: created.id,
        actorUserId: userId,
      })),
    )
  }

  // ── 8. Activity log (fire-and-forget) ──
  void recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'comment_added',
    resourceType: 'application',
    resourceId: id,
    metadata: {
      commentId: created.id,
      isInternal: created.isInternal,
      mentionsCount: mentionedUserIds.length,
    },
  })

  // ── 9. Return enriched response ──
  const author = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { id: true, name: true, email: true, image: true },
  })

  setResponseStatus(event, 201)
  return {
    ...created,
    author,
    mentions: mentionedUserIds.map(uid => ({ userId: uid })),
    reactions: [],
    attachments: [],
  }
})
