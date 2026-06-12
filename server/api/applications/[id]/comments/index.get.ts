import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  application,
  applicationComment,
  commentMention,
  commentReaction,
  commentAttachment,
} from '../../../../database/schema/app'
import { user } from '../../../../database/schema/auth'
import { applicationIdParamSchema } from '../../../../utils/schemas/application'
import { applicationCommentQuerySchema } from '../../../../utils/schemas/applicationComment'
import { canSeeInternal, getMemberRole } from '../../../../utils/comments/visibility'

/**
 * GET /api/applications/:id/comments
 * Returns the collaboration thread for an application, oldest-first.
 *
 * Visibility:
 *   - role IN ('owner','admin','recruiter')       → sees all (incl. is_internal)
 *   - role IN ('hiring_manager','member')         → only is_internal=false
 *
 * Each comment is enriched with author, mentions, reactions (grouped), and
 * attachments. Soft-deleted comments (deletedAt IS NOT NULL) are excluded.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  const query = await getValidatedQuery(event, applicationCommentQuerySchema.parse)

  // ── 1. Verify application belongs to org ──
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  // ── 2. Resolve viewer role for internal-visibility filter ──
  const role = await getMemberRole(db, orgId, userId)
  const seesInternal = canSeeInternal(role)

  // ── 3. Fetch comments (oldest first — chat-style) ──
  const offset = (query.page - 1) * query.limit
  const whereClause = seesInternal
    ? and(eq(applicationComment.applicationId, id), isNull(applicationComment.deletedAt))
    : and(
        eq(applicationComment.applicationId, id),
        isNull(applicationComment.deletedAt),
        eq(applicationComment.isInternal, false),
      )

  const comments = await db
    .select({
      id: applicationComment.id,
      body: applicationComment.body,
      bodyHtml: applicationComment.bodyHtml,
      isInternal: applicationComment.isInternal,
      parentCommentId: applicationComment.parentCommentId,
      editedAt: applicationComment.editedAt,
      createdAt: applicationComment.createdAt,
      updatedAt: applicationComment.updatedAt,
      authorId: applicationComment.authorUserId,
      authorName: user.name,
      authorEmail: user.email,
      authorImage: user.image,
    })
    .from(applicationComment)
    .innerJoin(user, eq(user.id, applicationComment.authorUserId))
    .where(whereClause)
    .orderBy(asc(applicationComment.createdAt))
    .limit(query.limit)
    .offset(offset)

  if (comments.length === 0) {
    return { data: [], total: 0, page: query.page, limit: query.limit }
  }

  const commentIds = comments.map(c => c.id)

  // ── 4. Fetch related: mentions, reactions, attachments ──
  const [mentions, reactions, attachments, totalRow] = await Promise.all([
    db
      .select({
        commentId: commentMention.commentId,
        userId: commentMention.mentionedUserId,
        name: user.name,
        email: user.email,
      })
      .from(commentMention)
      .innerJoin(user, eq(user.id, commentMention.mentionedUserId))
      .where(inArray(commentMention.commentId, commentIds)),
    db
      .select({
        commentId: commentReaction.commentId,
        userId: commentReaction.userId,
        emoji: commentReaction.emoji,
      })
      .from(commentReaction)
      .where(inArray(commentReaction.commentId, commentIds)),
    db
      .select({
        id: commentAttachment.id,
        commentId: commentAttachment.commentId,
        fileName: commentAttachment.fileName,
        storageKey: commentAttachment.storageKey,
        mimeType: commentAttachment.mimeType,
        sizeBytes: commentAttachment.sizeBytes,
        uploadedByUserId: commentAttachment.uploadedByUserId,
        createdAt: commentAttachment.createdAt,
      })
      .from(commentAttachment)
      .where(inArray(commentAttachment.commentId, commentIds)),
    db.$count(applicationComment, whereClause),
  ])

  // ── 5. Stitch ──
  const mentionsByComment = new Map<string, Array<{ userId: string; name: string | null; email: string | null }>>()
  for (const m of mentions) {
    if (!mentionsByComment.has(m.commentId)) mentionsByComment.set(m.commentId, [])
    mentionsByComment.get(m.commentId)!.push({ userId: m.userId, name: m.name, email: m.email })
  }

  // group reactions by emoji
  const reactionsByComment = new Map<string, Map<string, { emoji: string; count: number; userIds: string[]; reactedByMe: boolean }>>()
  for (const r of reactions) {
    if (!reactionsByComment.has(r.commentId)) reactionsByComment.set(r.commentId, new Map())
    const g = reactionsByComment.get(r.commentId)!
    let row = g.get(r.emoji)
    if (!row) {
      row = { emoji: r.emoji, count: 0, userIds: [], reactedByMe: false }
      g.set(r.emoji, row)
    }
    row.count += 1
    row.userIds.push(r.userId)
    if (r.userId === userId) row.reactedByMe = true
  }

  const attachmentsByComment = new Map<string, typeof attachments>()
  for (const a of attachments) {
    if (!attachmentsByComment.has(a.commentId)) attachmentsByComment.set(a.commentId, [])
    attachmentsByComment.get(a.commentId)!.push(a)
  }

  const data = comments.map(c => ({
    id: c.id,
    body: c.body,
    bodyHtml: c.bodyHtml,
    isInternal: c.isInternal,
    parentCommentId: c.parentCommentId,
    editedAt: c.editedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    author: {
      id: c.authorId,
      name: c.authorName,
      email: c.authorEmail,
      image: c.authorImage,
    },
    mentions: mentionsByComment.get(c.id) ?? [],
    reactions: Array.from(reactionsByComment.get(c.id)?.values() ?? []),
    attachments: attachmentsByComment.get(c.id) ?? [],
  }))

  return { data, total: totalRow, page: query.page, limit: query.limit }
})
