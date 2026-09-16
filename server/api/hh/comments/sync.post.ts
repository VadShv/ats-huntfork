/**
 * POST /api/hh/comments/sync  body: { applicationId }
 *
 * Bidirectional sync of application comments with hh.ru negotiations:
 *   - INBOUND:  pull applicant messages from hh.ru, dedup by hhMessageId, insert locally.
 *   - OUTBOUND: find comments with hhSyncStatus='pending', send them to hh.ru.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  application,
  applicationComment,
} from '../../../database/schema/app'
import { apiGet } from '../../../utils/hh/client'
import { resolveHhConfig } from '../../../utils/hh/config'
import { getValidAccessToken } from '../../../utils/hh/tokens'
import { sendNegotiationMessage } from '../../../utils/hh/sourcing/pushAction'
import { renderMarkdown } from '../../../utils/comments/sanitize'
import { stripHtml } from '../../../utils/hh/vacancyParser'
import { resolveHhAccountForJob } from '../../../utils/hh/link'

interface HhMessage {
  id: string
  text?: string
  author?: { type?: string }
  created_at?: string
}

interface HhMessagesResponse {
  items?: HhMessage[]
  found?: number
}

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

  const errors: string[] = []
  let inboundCount = 0
  let outboundCount = 0

  // ── 3. INBOUND: fetch messages from hh.ru ──
  if (syncRateLimitOk(app.id)) {
    try {
      const data = await apiGet<HhMessagesResponse>(
        `/negotiations/${app.externalId}/messages`,
        token,
        undefined,
        config,
      )
      const messages = data.items ?? []

      // Batch dedup: collect applicant message IDs and query once
      const applicantMsgIds = messages
        .filter(m => m.author?.type === 'applicant' && m.id)
        .map(m => m.id!) as string[]
      const existingIds = applicantMsgIds.length > 0
        ? new Set((await db
            .select({ hhMessageId: applicationComment.hhMessageId })
            .from(applicationComment)
            .where(and(
              eq(applicationComment.applicationId, app.id),
              inArray(applicationComment.hhMessageId, applicantMsgIds),
            )))
            .map(r => r.hhMessageId))
        : new Set<string | null>([])

      for (const msg of messages) {
        // Only import messages from the applicant (incoming)
        if (!msg.author || msg.author.type !== 'applicant') continue
        if (!msg.id) continue

        // Dedup: skip if already imported
        if (existingIds.has(msg.id)) continue

        const rawText = msg.text ?? ''
        const plainBody = stripHtml(rawText)
        if (!plainBody) continue

        const now = new Date(msg.created_at ?? Date.now())
        try {
          await db.insert(applicationComment).values({
            organizationId: orgId,
            applicationId: app.id,
            candidateId: app.candidateId,
            authorUserId: userId,
            body: plainBody,
            bodyHtml: renderMarkdown(plainBody),
            isInternal: false,
            hhMessageId: msg.id,
            hhDirection: 'incoming',
            hhSyncStatus: 'synced',
            hhSyncedAt: now,
            createdAt: now,
          })
          inboundCount++
        } catch (err) {
          errors.push(`Не удалось импортировать сообщение ${msg.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } catch (err) {
      errors.push(`Ошибка загрузки сообщений: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── 4. OUTBOUND: send pending comments to hh.ru ──
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
      await sendNegotiationMessage({
        organizationId: orgId,
        hhAccountId,
        negotiationId: app.externalId,
        messageText: comment.body,
        userId,
        applicationId: app.id,
      })
      outboundCount++
    } catch (err) {
      await db.update(applicationComment).set({ hhSyncStatus: 'failed' }).where(eq(applicationComment.id, comment.id))
      errors.push(`Не удалось отправить: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    // Best-effort status update — don't mark as failed if this throws
    try {
      await db.update(applicationComment).set({ hhSyncStatus: 'synced', hhSyncedAt: new Date() }).where(eq(applicationComment.id, comment.id))
    } catch {
      // Send succeeded but status update failed — log but don't mark as failed
      errors.push(`Отправлено, но не удалось обновить статус комментария ${comment.id}`)
    }
  }

  return { inboundCount, outboundCount, errors }
})
