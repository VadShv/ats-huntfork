import { and, eq } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../utils/access/scope'
import {
  application,
  applicationComment,
  applicationWatcher,
  candidate,
  commentMention,
} from '../../../../database/schema/app'
import { user } from '../../../../database/schema/auth'
import { applicationIdParamSchema } from '../../../../utils/schemas/application'
import { createApplicationCommentSchema } from '../../../../utils/schemas/applicationComment'
import { parseMentionTokens, resolveMentions, containsAiMention, extractAiQuestion } from '../../../../utils/comments/mention-parser'
import { ensureWatcher } from '../../../../utils/comments/ensure-watcher'
import { renderMarkdown } from '../../../../utils/comments/sanitize'
import { createApplicantComment, extractApplicantId } from '../../../../utils/hh/applicantComments'
import { resolveHhAccountForJob } from '../../../../utils/hh/link'
import { resolveHhConfig } from '../../../../utils/hh/config'
import { getValidAccessToken } from '../../../../utils/hh/tokens'
import {
  createNotification,
  createNotificationsBulk,
} from '../../../../utils/comments/notifications'
import { canSeeInternal, getMemberRole } from '../../../../utils/comments/visibility'
import { notifyThreadChanged } from '../../../../utils/comments/threadBus'
import { enqueueAiThreadResponse } from '../../../../utils/comments/ai-thread-worker'

/** In-memory rate-limit для @AI-вызовов: 1 на (user, application) в 30с. */
const _aiRateLimit = new Map<string, number>()
function aiRateLimitOk(key: string): boolean {
  const now = Date.now()
  const last = _aiRateLimit.get(key) ?? 0
  if (now - last < 30_000) return false
  _aiRateLimit.set(key, now)
  return true
}

let _hhSendInFlight = 0
const HH_SEND_CONCURRENCY = 3

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
  await requireApplicationInScope(event, id as string, orgId)
  const body = await readValidatedBody(event, createApplicationCommentSchema.parse)

  // ── 1. Verify application ──
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true, candidateId: true, source: true, externalId: true, jobId: true },
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
  const hhLinked = app.source === 'hh' && !!app.externalId
  const shouldSyncToHh = hhLinked && !body.hhLocalOnly

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
      ...(shouldSyncToHh
        ? { hhSyncStatus: 'pending' as const, hhDirection: 'outbound' as const }
        : {}),
    })
    .returning({
      id: applicationComment.id,
      body: applicationComment.body,
      bodyHtml: applicationComment.bodyHtml,
      isInternal: applicationComment.isInternal,
      parentCommentId: applicationComment.parentCommentId,
      hhSyncStatus: applicationComment.hhSyncStatus,
      hhDirection: applicationComment.hhDirection,
      createdAt: applicationComment.createdAt,
      updatedAt: applicationComment.updatedAt,
    })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось создать комментарий' })
  }

  // ── 4a. Fire-and-forget: push to hh.ru applicant_comments if pending ──
  if (created.hhSyncStatus === 'pending') {
    void (async () => {
      if (_hhSendInFlight >= HH_SEND_CONCURRENCY) {
        return
      }
      _hhSendInFlight++
      try {
        const hhAccountId = await resolveHhAccountForJob(orgId, app.jobId)
        const token = await getValidAccessToken(hhAccountId)
        const config = await resolveHhConfig(orgId)

        const cand = await db.query.candidate.findFirst({
          where: eq(candidate.id, app.candidateId),
          columns: { hhApplicantId: true, hhResumeRaw: true },
        })
        const applicantId = cand?.hhApplicantId ?? extractApplicantId(cand?.hhResumeRaw)
        if (!applicantId) {
          throw new Error('Нет applicant_id (резюме без owner.id)')
        }

        const hhComment = await createApplicantComment(applicantId, body.body, token, config)
        await db.update(applicationComment).set({
          hhSyncStatus: 'synced',
          hhSyncedAt: new Date(),
          hhCommentId: hhComment.id,
          hhApplicantId: applicantId,
        }).where(eq(applicationComment.id, created.id))
      } catch {
        await db.update(applicationComment).set({ hhSyncStatus: 'failed' }).where(eq(applicationComment.id, created.id))
      } finally {
        _hhSendInFlight--
      }
    })()
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

  // Realtime: оповестить открытые треды (Этап 4)
  notifyThreadChanged(id)

  // ── @AI-ассистент: если тело содержит @ai — поставить задачу генерации ──
  if (containsAiMention(body.body)) {
    const rateKey = `${userId}:${id}`
    if (aiRateLimitOk(rateKey)) {
      void enqueueAiThreadResponse({
        applicationId: id,
        commentId: created.id,
        organizationId: orgId,
        userId,
        question: extractAiQuestion(body.body),
      })
    }
  }

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
    hhLocalOnly: body.hhLocalOnly ?? false,
  }
})
