/**
 * @AI-ассистент в треде обсуждения — фоновый воркер (pg-boss).
 *
 * Flow:
 *   1. Загрузить AI-конфиг орга (purpose 'interactive').
 *   2. Собрать контекст: вакансия, кандидат, скрининг, риск, последние 20 комментариев.
 *   3. generateText → ответ.
 *   4. INSERT application_comment kind='ai_response'.
 *   5. notifyThreadChanged → SSE-подписчики подтянут.
 *
 * Очередь: ai-thread-resp
 * Payload: { applicationId, commentId, organizationId, userId, question }
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { generateText } from 'ai'
import {
  application,
  applicationComment,
  job,
  candidate,
  analysisRun,
  candidateResumeVersion,
  resumeRisk,
} from '../../database/schema/app'
import { user } from '../../database/schema/auth'
import { getBoss } from '../queue/boss'
import { loadAiConfig } from '../ai/loadConfig'
import { createLanguageModel, type SupportedProvider } from '../ai/provider'
import { renderMarkdown } from './sanitize'
import { ensureWatcher } from './ensure-watcher'
import { notifyThreadChanged } from './threadBus'

export const AI_THREAD_RESP_QUEUE = 'ai-thread-resp'

export interface AiThreadResponsePayload {
  applicationId: string
  commentId: string
  organizationId: string
  userId: string
  question: string
}

/** Поставить задачу генерации @AI-ответа. Best-effort. */
export async function enqueueAiThreadResponse(payload: AiThreadResponsePayload): Promise<void> {
  try {
    const boss = await getBoss()
    await boss.send(AI_THREAD_RESP_QUEUE, payload, {
      retryLimit: 1,
      retryDelay: 15,
      retryBackoff: true,
      expireInSeconds: 3 * 60,
    })
    logDebug('ai_thread.enqueued', {
      application_id: payload.applicationId,
      comment_id: payload.commentId,
      module: 'ai-thread',
    })
  }
  catch (err) {
    logError('ai_thread.enqueue_failed', {
      application_id: payload.applicationId,
      error_message: err instanceof Error ? err.message : String(err),
      module: 'ai-thread',
    })
  }
}

/** Вставить системный комментарий kind='ai_response' (ответ или сообщение об ошибке). */
async function insertAiResponse(params: {
  applicationId: string
  organizationId: string
  userId: string
  body: string
  triggeredByCommentId: string
  model?: string | null
}): Promise<void> {
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, params.applicationId), eq(application.organizationId, params.organizationId)),
    columns: { id: true, candidateId: true },
  })
  if (!app) return

  await db.insert(applicationComment).values({
    organizationId: params.organizationId,
    applicationId: params.applicationId,
    candidateId: app.candidateId,
    authorUserId: params.userId,
    body: params.body,
    bodyHtml: renderMarkdown(params.body),
    isInternal: false,
    kind: 'ai_response',
    payloadJson: {
      model: params.model ?? null,
      triggeredByCommentId: params.triggeredByCommentId,
      aiInvoked: true,
    },
  })

  await ensureWatcher(db, {
    organizationId: params.organizationId,
    applicationId: params.applicationId,
    userId: params.userId,
    source: 'auto_author',
  })
  notifyThreadChanged(params.applicationId)
}

/** Собрать компактный контекст для system prompt. */
async function buildContext(orgId: string, appId: string): Promise<string> {
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, appId), eq(application.organizationId, orgId)),
    columns: { id: true, candidateId: true, jobId: true },
  })
  if (!app) return 'Контекст недоступен.'

  const [jobRow, candidateRow] = await Promise.all([
    db.query.job.findFirst({
      where: eq(job.id, app.jobId),
      columns: { title: true },
    }),
    db.query.candidate.findFirst({
      where: eq(candidate.id, app.candidateId),
      columns: { name: true, email: true },
    }),
  ])

  // Последний скрининг
  const [latestRun] = await db
    .select({ compositeScore: analysisRun.compositeScore, status: analysisRun.status })
    .from(analysisRun)
    .where(and(eq(analysisRun.applicationId, appId), eq(analysisRun.organizationId, orgId)))
    .orderBy(desc(analysisRun.createdAt))
    .limit(1)

  // Риск (текущая версия резюме)
  let riskLevel: string | null = null
  try {
    const current = await db.query.candidateResumeVersion.findFirst({
      where: and(
        eq(candidateResumeVersion.candidateId, app.candidateId),
        eq(candidateResumeVersion.isCurrent, true),
      ),
      columns: { id: true },
    })
    const version = current ?? await db.query.candidateResumeVersion.findFirst({
      where: eq(candidateResumeVersion.candidateId, app.candidateId),
      orderBy: [desc(candidateResumeVersion.versionNumber)],
      columns: { id: true },
    })
    if (version) {
      const risk = await db.query.resumeRisk.findFirst({
        where: and(eq(resumeRisk.resumeVersionId, version.id), eq(resumeRisk.organizationId, orgId)),
        columns: { overallRisk: true, status: true },
      })
      if (risk?.status === 'completed') riskLevel = risk.overallRisk
    }
  } catch { /* soft fail */ }

  // Последние 20 комментариев (текст + автор)
  const recent = await db
    .select({
      body: applicationComment.body,
      kind: applicationComment.kind,
      authorName: user.name,
      createdAt: applicationComment.createdAt,
    })
    .from(applicationComment)
    .innerJoin(user, eq(user.id, applicationComment.authorUserId))
    .where(and(
      eq(applicationComment.applicationId, appId),
      eq(applicationComment.organizationId, orgId),
      isNull(applicationComment.deletedAt),
    ))
    .orderBy(desc(applicationComment.createdAt))
    .limit(20)

  const history = recent
    .reverse()
    .map(r => {
      const name = r.authorName ?? 'Аноним'
      const tag = r.kind === 'ai_response' ? ' [AI]' : r.kind && r.kind !== 'text' ? ` [${r.kind}]` : ''
      return `${name}${tag}: ${r.body}`
    })
    .join('\n')

  const lines = [
    `Вакансия: ${jobRow?.title ?? '—'}`,
    `Кандидат: ${candidateRow?.name ?? candidateRow?.email ?? '—'}`,
    `Скрининг: ${latestRun?.compositeScore != null ? `${latestRun.compositeScore}/100` : 'не запускался'}`,
    `Риск: ${riskLevel ?? 'не оценивался'}`,
  ]
  if (history) lines.push('', 'История обсуждения (последние сообщения):', history)

  return lines.join('\n')
}

/**
 * Worker — генерирует @AI-ответ и вставляет его в тред.
 * pg-boss 10 передаёт МАССИВ джобов (batch) — обрабатываем каждый.
 */
export async function handleAiThreadResponse(
  jobs: { data: AiThreadResponsePayload } | { data: AiThreadResponsePayload }[],
): Promise<void> {
  const list = Array.isArray(jobs) ? jobs : [jobs]
  for (const j of list) {
    await runAiThreadResponse(j.data)
  }
}

async function runAiThreadResponse(payload: AiThreadResponsePayload): Promise<void> {
  const { applicationId, commentId, organizationId, userId, question } = payload

  try {
    const cfg = await loadAiConfig(organizationId, { purpose: 'interactive' })

    const model = createLanguageModel({
      provider: cfg.provider as SupportedProvider,
      model: cfg.model,
      apiKeyEncrypted: cfg.apiKeyEncrypted,
      baseUrl: cfg.baseUrl,
      maxTokens: Math.min(cfg.maxTokens, 800),
    })

    const context = await buildContext(organizationId, applicationId)

    const system = [
      'Ты — рекрутер-ассистент внутри обсуждения кандидата в ATS.',
      'Отвечай кратко (2–4 предложения), по-русски, без markdown-заголовков.',
      'Опирайся только на предоставленный контекст и историю обсуждения.',
      'Не выдумывай факты, оценки или имена. Если данных нет — скажи прямо.',
      '',
      'Контекст:',
      context,
    ].join('\n')

    const result = await generateText({
      model,
      system,
      prompt: question || 'Дай краткую рекомендацию по кандидату на основе контекста.',
      temperature: 0.3,
      maxOutputTokens: 800,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(60_000),
    })

    const text = (result.text || '').trim()
    if (!text) {
      await insertAiResponse({
        applicationId, organizationId, userId,
        body: 'AI-ассистент не смог сформулировать ответ. Попробуйте переформулировать вопрос.',
        triggeredByCommentId: commentId,
        model: cfg.model,
      })
      return
    }

    await insertAiResponse({
      applicationId, organizationId, userId,
      body: text,
      triggeredByCommentId: commentId,
      model: cfg.model,
    })

    logInfo('ai_thread.response_created', {
      application_id: applicationId,
      model: cfg.model,
      module: 'ai-thread',
    })
  }
  catch (err: any) {
    const isNotConfigured = err?.statusCode === 422
    const message = isNotConfigured
      ? 'AI не настроен для этой организации. Добавьте поставщика в Настройках → ИИ.'
      : `Не удалось сгенерировать ответ: ${err instanceof Error ? err.message : String(err)}`

    await insertAiResponse({
      applicationId, organizationId, userId,
      body: message,
      triggeredByCommentId: commentId,
    })

    logError('ai_thread.generate_failed', {
      application_id: applicationId,
      error_message: err instanceof Error ? err.message : String(err),
      module: 'ai-thread',
    })
  }
}
