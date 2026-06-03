/**
 * POST /api/jobs/:id/batch-score
 *
 * Запускает AI-скоринг для нескольких откликов одной вакансии.
 *
 * Тело:
 *   { mode: 'all' }                    — скорим все отклики этой вакансии,
 *                                        у которых ещё нет score (или score===null).
 *   { mode: 'selected', ids: [...] }   — скорим только переданные application.id.
 *   { mode: 'rescore_all' }            — пересчитываем ВСЕ отклики, даже уже оценённые.
 *
 * Использует существующий /api/applications/:id/analyze под капотом
 * (через прямой вызов scoreApplication), с ограниченным concurrency=3,
 * чтобы не уронить YandexGPT квоту.
 *
 * Возвращает { total, succeeded, failed, results: [...] }
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import {
  analysisRun,
  application,
  criterionScore,
  document,
  job,
  scoringCriterion,
} from '../../../database/schema'
import { loadAiConfig } from '../../../utils/ai/loadConfig'
import type { SupportedProvider } from '../../../utils/ai/provider'
import { computeCompositeScore, scoreApplication } from '../../../utils/ai/scoring'
import type { CriterionDefinition } from '../../../utils/ai/scoring'
import { extractResumeText } from '../../../utils/resume-parser'
import { createRateLimiter } from '../../../utils/rateLimit'

const paramsSchema = z.object({ id: z.string().min(1) })
const bodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('rescore_all') }),
  z.object({ mode: z.literal('selected'), ids: z.array(z.string().min(1)).min(1).max(500) }),
])

// 2 batch-запуска в минуту на пользователя — защита от случайного двойного клика
// и от того, чтобы кто-то не запустил подряд 10 раз скоринг по 200 откликам.
const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 5,
  message: 'Слишком частые запуски пакетного скоринга. Подождите минуту.',
})

const CONCURRENCY = 3

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { scoring: ['create'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = bodySchema.parse(await readBody(event))

  // 1. Проверим что вакансия наша + получим описание + критерии
  const jobRow = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true, title: true, description: true },
  })
  if (!jobRow) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }
  if (!jobRow.description) {
    throw createError({
      statusCode: 422,
      statusMessage: 'У вакансии не заполнено описание — скоринг невозможен',
    })
  }

  const criteria = await db
    .select()
    .from(scoringCriterion)
    .where(and(
      eq(scoringCriterion.jobId, jobId),
      eq(scoringCriterion.organizationId, orgId),
    ))
  if (criteria.length === 0) {
    throw createError({
      statusCode: 422,
      statusMessage: 'У вакансии не настроены критерии оценки. Добавьте их в настройках.',
    })
  }
  const criteriaDefinitions: CriterionDefinition[] = criteria.map(c => ({
    key: c.key,
    name: c.name,
    description: c.description,
    category: c.category,
    maxScore: c.maxScore,
    weight: c.weight,
  }))

  // 2. Загрузим AI-конфиг один раз
  let config
  try {
    config = await loadAiConfig(orgId, { purpose: 'analysis' })
  }
  catch (err) {
    throw createError({
      statusCode: 422,
      statusMessage: `Не настроен AI-провайдер для скоринга: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
  const providerConfig = {
    provider: config.provider as SupportedProvider,
    model: config.model,
    apiKeyEncrypted: config.apiKeyEncrypted,
    baseUrl: config.baseUrl,
    maxTokens: config.maxTokens,
  }

  // 3. Выберем applications по режиму
  let applications: Array<{
    id: string
    candidateId: string
    coverLetterText: string | null
    notes: string | null
    score: number | null
  }>
  if (body.mode === 'selected') {
    applications = await db
      .select({
        id: application.id,
        candidateId: application.candidateId,
        coverLetterText: application.coverLetterText,
        notes: application.notes,
        score: application.score,
      })
      .from(application)
      .where(and(
        eq(application.organizationId, orgId),
        eq(application.jobId, jobId),
        inArray(application.id, body.ids),
      ))
  }
  else if (body.mode === 'all') {
    applications = await db
      .select({
        id: application.id,
        candidateId: application.candidateId,
        coverLetterText: application.coverLetterText,
        notes: application.notes,
        score: application.score,
      })
      .from(application)
      .where(and(
        eq(application.organizationId, orgId),
        eq(application.jobId, jobId),
        isNull(application.score),
      ))
  }
  else {
    // rescore_all
    applications = await db
      .select({
        id: application.id,
        candidateId: application.candidateId,
        coverLetterText: application.coverLetterText,
        notes: application.notes,
        score: application.score,
      })
      .from(application)
      .where(and(
        eq(application.organizationId, orgId),
        eq(application.jobId, jobId),
      ))
  }

  if (applications.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, skipped: 0, results: [] }
  }

  // 4. Соберём резюме одним запросом
  const candidateIds = Array.from(new Set(applications.map(a => a.candidateId)))
  const docs = await db
    .select({
      candidateId: document.candidateId,
      type: document.type,
      parsedContent: document.parsedContent,
    })
    .from(document)
    .where(and(
      inArray(document.candidateId, candidateIds),
      eq(document.organizationId, orgId),
    ))
  const resumeByCandidate = new Map<string, unknown>()
  for (const d of docs) {
    if (d.type === 'resume' && !resumeByCandidate.has(d.candidateId)) {
      resumeByCandidate.set(d.candidateId, d.parsedContent)
    }
  }

  // 5. Параллельный пайплайн с CONCURRENCY=3
  const queue = applications.slice()
  const results: Array<{
    applicationId: string
    status: 'scored' | 'skipped' | 'failed'
    compositeScore?: number
    reason?: string
  }> = []

  async function worker() {
    while (queue.length > 0) {
      const app = queue.shift()
      if (!app) break

      const resumeText = extractResumeText(resumeByCandidate.get(app.candidateId))
      if (!resumeText) {
        results.push({
          applicationId: app.id,
          status: 'skipped',
          reason: 'нет резюме или не удалось извлечь текст',
        })
        continue
      }

      try {
        const result = await scoreApplication(providerConfig, {
          jobTitle: jobRow.title,
          jobDescription: jobRow.description!,
          criteria: criteriaDefinitions,
          resumeText,
          coverLetterText: app.coverLetterText,
          applicationNotes: app.notes,
        })
        const compositeScore = computeCompositeScore(criteriaDefinitions, result.scoring.evaluations)

        const scoreValues = result.scoring.evaluations.map(ev => ({
          organizationId: orgId,
          applicationId: app.id,
          criterionKey: ev.criterionKey,
          maxScore: ev.maxScore,
          applicantScore: ev.applicantScore,
          confidence: ev.confidence,
          evidence: ev.evidence,
          strengths: ev.strengths,
          gaps: ev.gaps,
        }))

        await db.transaction(async (tx) => {
          await tx.delete(criterionScore).where(and(
            eq(criterionScore.applicationId, app.id),
            eq(criterionScore.organizationId, orgId),
          ))
          if (scoreValues.length > 0) {
            await tx.insert(criterionScore).values(scoreValues)
          }
          await tx.update(application)
            .set({ score: compositeScore, updatedAt: new Date() })
            .where(eq(application.id, app.id))
          await tx.insert(analysisRun).values({
            organizationId: orgId,
            applicationId: app.id,
            status: 'completed',
            provider: config.provider,
            model: config.model,
            criteriaSnapshot: criteriaDefinitions as any,
            compositeScore,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            scoredById: session.user.id,
          })
        })

        results.push({ applicationId: app.id, status: 'scored', compositeScore })
      }
      catch (err: any) {
        try {
          await db.insert(analysisRun).values({
            organizationId: orgId,
            applicationId: app.id,
            status: 'failed',
            provider: config.provider,
            model: config.model,
            criteriaSnapshot: criteriaDefinitions as any,
            errorMessage: (err?.message ?? 'Unknown error').slice(0, 500),
            scoredById: session.user.id,
          })
        } catch { /* лог best-effort */ }
        results.push({
          applicationId: app.id,
          status: 'failed',
          reason: err?.message ?? 'Unknown error',
        })
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  const succeeded = results.filter(r => r.status === 'scored').length
  const failed = results.filter(r => r.status === 'failed').length
  const skipped = results.filter(r => r.status === 'skipped').length

  return {
    total: applications.length,
    succeeded,
    failed,
    skipped,
    results,
  }
})
