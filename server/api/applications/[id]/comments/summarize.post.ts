import { and, desc, eq, isNull } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../utils/access/scope'
import { generateText } from 'ai'
import {
  application,
  applicationComment,
  job,
  candidate,
  analysisRun,
  candidateResumeVersion,
  resumeRisk,
} from '../../../../database/schema/app'
import { user } from '../../../../database/schema/auth'
import { applicationIdParamSchema } from '../../../../utils/schemas/application'
import { loadAiConfig } from '../../../../utils/ai/loadConfig'
import { createLanguageModel, type SupportedProvider } from '../../../../utils/ai/provider'
import { renderMarkdown } from '../../../../utils/comments/sanitize'
import { ensureWatcher } from '../../../../utils/comments/ensure-watcher'
import { notifyThreadChanged } from '../../../../utils/comments/threadBus'

/**
 * POST /api/applications/:id/comments/summarize
 *
 * AI-резюме (TL;DR) обсуждения кандидата. Собирает последние 50 комментариев +
 * контекст (вакансия/кандидат/скрининг/риск), генерирует краткую выжимку и
 * вставляет комментарий kind='ai_summary'. Rate-limit: 1 на application в 60с.
 */

const _summaryRateLimit = new Map<string, number>()

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, id as string, orgId)

  // ── Rate-limit ──
  const now = Date.now()
  const last = _summaryRateLimit.get(id) ?? 0
  if (now - last < 60_000) {
    throw createError({ statusCode: 429, statusMessage: 'Резюме можно генерировать не чаще раза в минуту' })
  }
  _summaryRateLimit.set(id, now)

  // ── Verify application ──
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true, candidateId: true, jobId: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  // ── AI config ──
  const cfg = await loadAiConfig(orgId, { purpose: 'interactive' })

  // ── Context ──
  const [jobRow, candidateRow] = await Promise.all([
    db.query.job.findFirst({ where: eq(job.id, app.jobId), columns: { title: true } }),
    db.query.candidate.findFirst({ where: eq(candidate.id, app.candidateId), columns: { name: true, email: true } }),
  ])

  const [latestRun] = await db
    .select({ compositeScore: analysisRun.compositeScore })
    .from(analysisRun)
    .where(and(eq(analysisRun.applicationId, id), eq(analysisRun.organizationId, orgId)))
    .orderBy(desc(analysisRun.createdAt))
    .limit(1)

  let riskLevel: string | null = null
  try {
    const current = await db.query.candidateResumeVersion.findFirst({
      where: and(eq(candidateResumeVersion.candidateId, app.candidateId), eq(candidateResumeVersion.isCurrent, true)),
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

  // Последние 50 комментариев
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
      eq(applicationComment.applicationId, id),
      eq(applicationComment.organizationId, orgId),
      isNull(applicationComment.deletedAt),
    ))
    .orderBy(desc(applicationComment.createdAt))
    .limit(50)

  const history = recent
    .reverse()
    .map(r => {
      const name = r.authorName ?? 'Аноним'
      const tag = r.kind === 'ai_response' ? ' [AI]' : r.kind && r.kind !== 'text' ? ` [${r.kind}]` : ''
      return `${name}${tag}: ${r.body}`
    })
    .join('\n')

  // ── Generate ──
  const model = createLanguageModel({
    provider: cfg.provider as SupportedProvider,
    model: cfg.model,
    apiKeyEncrypted: cfg.apiKeyEncrypted,
    baseUrl: cfg.baseUrl,
    maxTokens: Math.min(cfg.maxTokens, 600),
  })

  const system = [
    'Ты — рекрутер-ассистент. Кратко резюмируй обсуждение кандидата в 3–5 буллетах.',
    'Выдели: ключевые мнения, риски, договорённости и следующий шаг (если есть).',
    'Отвечай по-русски, markdown-списком (•). Не выдумывай факты.',
    '',
    `Вакансия: ${jobRow?.title ?? '—'}`,
    `Кандидат: ${candidateRow?.name ?? candidateRow?.email ?? '—'}`,
    `Скрининг: ${latestRun?.compositeScore != null ? `${latestRun.compositeScore}/100` : '—'}`,
    `Риск: ${riskLevel ?? '—'}`,
  ].join('\n')

  const result = await generateText({
    model,
    system,
    prompt: history || 'Обсуждение пустое.',
    temperature: 0.3,
    maxOutputTokens: 600,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(60_000),
  })

  const text = (result.text || '').trim()
  if (!text) {
    throw createError({ statusCode: 502, statusMessage: 'AI не смог сгенерировать резюме' })
  }

  // ── INSERT ai_summary comment ──
  const [created] = await db
    .insert(applicationComment)
    .values({
      organizationId: orgId,
      applicationId: id,
      candidateId: app.candidateId,
      authorUserId: userId,
      body: text,
      bodyHtml: renderMarkdown(text),
      isInternal: false,
      kind: 'ai_summary',
      payloadJson: {
        model: cfg.model,
        summarizedCount: recent.length,
        generatedAt: new Date().toISOString(),
      },
    })
    .returning({
      id: applicationComment.id,
      body: applicationComment.body,
      bodyHtml: applicationComment.bodyHtml,
      isInternal: applicationComment.isInternal,
      kind: applicationComment.kind,
      payloadJson: applicationComment.payloadJson,
      parentCommentId: applicationComment.parentCommentId,
      createdAt: applicationComment.createdAt,
      updatedAt: applicationComment.updatedAt,
    })

  if (!created) throw createError({ statusCode: 500, statusMessage: 'Не удалось сохранить резюме' })

  await ensureWatcher(db, { organizationId: orgId, applicationId: id, userId, source: 'auto_author' })
  notifyThreadChanged(id)

  void recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'comment_added',
    resourceType: 'application',
    resourceId: id,
    metadata: { commentId: created.id, kind: 'ai_summary' },
  })

  const author = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { id: true, name: true, email: true, image: true },
  })

  setResponseStatus(event, 201)
  return { ...created, author, mentions: [], reactions: [], attachments: [] }
})
