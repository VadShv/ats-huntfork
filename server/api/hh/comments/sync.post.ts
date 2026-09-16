/**
 * POST /api/hh/comments/sync  body: { applicationId }
 *
 * Bidirectional sync of application comments with hh.ru applicant_comments:
 *   - INBOUND:  pull applicant comments from hh.ru, dedup by hhCommentId, insert locally.
 *   - OUTBOUND: find comments with hhSyncStatus='pending', push them to hh.ru applicant_comments.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  application,
  applicationComment,
  candidate,
} from '../../../database/schema/app'
import { resolveHhConfig } from '../../../utils/hh/config'
import { getValidAccessToken } from '../../../utils/hh/tokens'
import {
  createApplicantComment,
  listApplicantComments,
  extractApplicantId,
} from '../../../utils/hh/applicantComments'
import { renderMarkdown } from '../../../utils/comments/sanitize'
import { stripHtml } from '../../../utils/hh/vacancyParser'
import { resolveHhAccountForJob } from '../../../utils/hh/link'

const _syncRateLimit = new Map<string, number>()
function syncRateLimitOk(key: string): boolean {
  const now = Date.now()
  const last = _syncRateLimit.get(key) ?? 0
  if (now - last < 30_000) return false
  _syncRateLimit.set(key, now)
  return true
}

export default defineEventHandler(async (event) => {
  const { session, user } = await requirePermission(event, { hhComment: ['sync'] })
  const orgId = session.activeOrganizationId
  const userId = user.id

  const body = await readBody<{ applicationId?: string }>(event)
  const applicationId = body?.applicationId
  if (!applicationId) {
    throw createError({ statusCode: 400, statusMessage: 'applicationId обязателен' })
  }

  // ── 1. Load application, verify org + hh-linked ──
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    columns: { id: true, candidateId: true, source: true, externalId: true, jobId: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  if (app.source !== 'hh' || !app.externalId) {
    throw createError({ statusCode: 400, statusMessage: 'Отклик не связан с hh.ru' })
  }

  // ── 2. Resolve hhVacancyLink → hhAccountId ──
  const hhAccountId = await resolveHhAccountForJob(orgId, app.jobId)

  const config = await resolveHhConfig(orgId)
  let token: string
  try {
    token = await getValidAccessToken(hhAccountId)
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `Не удалось получить токен hh.ru: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  // ── 2a. Resolve applicant_id ──
  const cand = await db.query.candidate.findFirst({
    where: eq(candidate.id, app.candidateId),
    columns: { hhApplicantId: true, hhResumeRaw: true },
  })
  const applicantId = cand?.hhApplicantId ?? extractApplicantId(cand?.hhResumeRaw)
  if (!applicantId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Нет applicant_id (резюме без owner.id) — синхронизация невозможна',
    })
  }

  const errors: string[] = []
  let inboundCount = 0
  let outboundCount = 0

  // ── 3. INBOUND: fetch applicant comments from hh.ru ──
  if (syncRateLimitOk(app.id)) {
    try {
      const data = await listApplicantComments(applicantId, token, config)
      const comments = data.items ?? []

      // Batch dedup: collect comment IDs and query once
      const commentIds = comments.filter(c => c.id).map(c => c.id!) as string[]
      const existingIds = commentIds.length > 0
        ? new Set((await db
            .select({ hhCommentId: applicationComment.hhCommentId })
            .from(applicationComment)
            .where(and(
              eq(applicationComment.applicationId, app.id),
              inArray(applicationComment.hhCommentId, commentIds),
            )))
            .map(r => r.hhCommentId))
        : new Set<string | null>([])

      for (const c of comments) {
        if (!c.id) continue
        if (existingIds.has(c.id)) continue

        const rawText = c.text ?? ''
        const plainBody = stripHtml(rawText)
        if (!plainBody) continue

        const now = new Date(c.created_at ?? Date.now())
        try {
          await db.insert(applicationComment).values({
            organizationId: orgId,
            applicationId: app.id,
            candidateId: app.candidateId,
            authorUserId: userId,
            body: plainBody,
            bodyHtml: renderMarkdown(plainBody),
            isInternal: false,
            hhCommentId: c.id,
            hhApplicantId: applicantId,
            hhDirection: 'incoming',
            hhSyncStatus: 'synced',
            hhSyncedAt: now,
            createdAt: now,
          })
          inboundCount++
        } catch (err) {
          errors.push(`Не удалось импортировать комментарий ${c.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } catch (err) {
      errors.push(`Ошибка загрузки комментариев: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── 4. OUTBOUND: push pending comments to hh.ru applicant_comments ──
  const pendingComments = await db
    .select({
      id: applicationComment.id,
      body: applicationComment.body,
    })
    .from(applicationComment)
    .where(and(
      eq(applicationComment.applicationId, app.id),
      eq(applicationComment.hhSyncStatus, 'pending'),
      isNull(applicationComment.deletedAt),
    ))

  for (const comment of pendingComments) {
    try {
      const hhComment = await createApplicantComment(applicantId, comment.body, token, config)
      await db.update(applicationComment).set({
        hhSyncStatus: 'synced',
        hhSyncedAt: new Date(),
        hhCommentId: hhComment.id,
        hhApplicantId: applicantId,
      }).where(eq(applicationComment.id, comment.id))
      outboundCount++
    } catch (err) {
      await db.update(applicationComment).set({ hhSyncStatus: 'failed' }).where(eq(applicationComment.id, comment.id))
      errors.push(`Не удалось отправить: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { inboundCount, outboundCount, errors }
})
