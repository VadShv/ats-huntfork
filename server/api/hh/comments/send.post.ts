/**
 * POST /api/hh/comments/send  body: { commentId }
 *
 * Retry sending a single comment to hh.ru (for comments with hhSyncStatus
 * 'pending' or 'failed').
 */
import { and, eq } from 'drizzle-orm'
import {
  application,
  applicationComment,
} from '../../../database/schema/app'
import { sendNegotiationMessage } from '../../../utils/hh/sourcing/pushAction'
import { resolveHhAccountForJob } from '../../../utils/hh/link'

export default defineEventHandler(async (event) => {
  const { session, user } = await requirePermission(event, { hhComment: ['sync'] })
  const orgId = session.activeOrganizationId
  const userId = user.id

  const body = await readBody<{ commentId?: string }>(event)
  const commentId = body?.commentId
  if (!commentId) {
    throw createError({ statusCode: 400, statusMessage: 'commentId обязателен' })
  }

  // ── 1. Load comment ──
  const comment = await db.query.applicationComment.findFirst({
    where: eq(applicationComment.id, commentId),
    columns: { id: true, body: true, applicationId: true, hhSyncStatus: true, hhDirection: true },
  })
  if (!comment) throw createError({ statusCode: 404, statusMessage: 'Комментарий не найден' })

  // ── 2. Load application (verify org + hh-linked) ──
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, comment.applicationId), eq(application.organizationId, orgId)),
    columns: { id: true, source: true, externalId: true, jobId: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  if (app.source !== 'hh' || !app.externalId) {
    throw createError({ statusCode: 400, statusMessage: 'Отклик не связан с hh.ru' })
  }

  if (comment.hhSyncStatus !== 'pending' && comment.hhSyncStatus !== 'failed') {
    throw createError({ statusCode: 400, statusMessage: 'Комментарий не требует отправки' })
  }

  // ── 3. Resolve hhVacancyLink → hhAccountId ──
  const hhAccountId = await resolveHhAccountForJob(orgId, app.jobId)

  // ── 4. Send to hh.ru ──
  try {
    await sendNegotiationMessage({
      organizationId: orgId,
      hhAccountId,
      negotiationId: app.externalId,
      messageText: comment.body,
      userId,
      applicationId: app.id,
    })
    await db
      .update(applicationComment)
      .set({ hhSyncStatus: 'synced', hhSyncedAt: new Date() })
      .where(eq(applicationComment.id, commentId))
    return { sent: true }
  } catch (err) {
    await db
      .update(applicationComment)
      .set({ hhSyncStatus: 'failed' })
      .where(eq(applicationComment.id, commentId))
    throw createError({
      statusCode: 502,
      statusMessage: `Не удалось отправить на hh.ru: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
})
