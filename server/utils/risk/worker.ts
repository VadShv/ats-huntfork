/**
 * Фоновая очередь риск-анализа резюме (Этап 3).
 *
 * Оркестрирует: детерминированный слой (частота смен, timeline.ts) +
 * смысловой LLM-слой (assessRisk.ts) + агрегация с cap → запись в resume_risk
 * (по resumeVersionId). Кэш-гард по contentHash версии.
 *
 * Очередь: resume-risk
 * Payload: { organizationId, candidateId, resumeVersionId, triggeredById? }
 */
import { and, eq } from 'drizzle-orm'
import { candidateResumeVersion, resumeRisk, riskPolicy, document } from '../../database/schema'
import { getBoss } from '../queue/boss'
import { loadAiConfig } from '../ai/loadConfig'
import type { SupportedProvider } from '../ai/provider'
import { assessResumeRisk, aggregateRisk } from '../ai/assessRisk'
import { computeJobHopping, type JobHoppingPolicy } from './timeline'
import { resumeToText } from '../hh/sync'
import { extractResumeText } from '../resume-parser'

export const RESUME_RISK_QUEUE = 'resume-risk'

export interface ResumeRiskPayload {
  organizationId: string
  candidateId: string
  resumeVersionId: string
  triggeredById?: string | null
  /** Пропустить кэш-гард по contentHash (ручной «Обновить»). */
  force?: boolean
}

/** Поставить задачу риск-анализа. Идемпотентно по версии резюме. Best-effort. */
export async function enqueueResumeRisk(payload: ResumeRiskPayload): Promise<void> {
  try {
    const boss = await getBoss()
    await boss.send(RESUME_RISK_QUEUE, payload, {
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 5 * 60,
      singletonKey: `resume-risk:${payload.resumeVersionId}`,
      singletonHours: 1,
    })
    logDebug('risk.enqueued', {
      candidate_id: payload.candidateId,
      resume_version_id: payload.resumeVersionId,
      module: 'risk',
    })
  }
  catch (err) {
    logError('risk.enqueue_failed', {
      resume_version_id: payload.resumeVersionId,
      error_message: err instanceof Error ? err.message : String(err),
      module: 'risk',
    })
  }
}

/**
 * Worker — считает риск-профиль версии резюме и пишет resume_risk.
 * pg-boss 10 передаёт МАССИВ джобов (batch) — обрабатываем каждый.
 */
export async function processResumeRiskJob(
  jobs: { data: ResumeRiskPayload } | { data: ResumeRiskPayload }[],
): Promise<void> {
  const list = Array.isArray(jobs) ? jobs : [jobs]
  for (const job of list) {
    await runResumeRiskJob(job.data)
  }
}

async function runResumeRiskJob(payload: ResumeRiskPayload): Promise<void> {
  const { organizationId, candidateId, resumeVersionId, triggeredById, force } = payload
  const startedAt = Date.now()

  // Версия резюме (org-scope через candidate cascade — проверяем organizationId ниже).
  const version = await db.query.candidateResumeVersion.findFirst({
    where: eq(candidateResumeVersion.id, resumeVersionId),
    columns: { id: true, candidateId: true, contentHash: true, snapshot: true },
  })
  if (!version || version.candidateId !== candidateId) {
    logWarn('risk.version_not_found', { resume_version_id: resumeVersionId, module: 'risk' })
    return
  }

  // Кэш-гард: если уже посчитано на этом contentHash и не force — выходим.
  const existing = await db.query.resumeRisk.findFirst({
    where: and(eq(resumeRisk.resumeVersionId, resumeVersionId), eq(resumeRisk.organizationId, organizationId)),
    columns: { id: true, contentHash: true, status: true },
  })
  if (!force && existing && existing.status === 'completed' && existing.contentHash === version.contentHash) {
    logDebug('risk.cache_hit', { resume_version_id: resumeVersionId, module: 'risk' })
    return
  }

  // Отметка «running» (upsert по uniqueIndex resumeVersionId).
  const now = new Date()
  if (existing) {
    await db.update(resumeRisk)
      .set({ status: 'running', errorMessage: null, triggeredById: triggeredById ?? null })
      .where(eq(resumeRisk.id, existing.id))
  }
  else {
    await db.insert(resumeRisk)
      .values({ organizationId, candidateId, resumeVersionId, status: 'running', triggeredById: triggeredById ?? null })
      .onConflictDoNothing({ target: resumeRisk.resumeVersionId })
  }

  try {
    const snapshot = (version.snapshot ?? {}) as Record<string, any>

    // Политика организации (или дефолты).
    const policyRow = await db.query.riskPolicy.findFirst({
      where: eq(riskPolicy.organizationId, organizationId),
    })
    const jhPolicy: JobHoppingPolicy = {
      shortStintMonths: policyRow?.shortStintMonths ?? 12,
      mediumScore: policyRow?.jobHoppingMediumScore ?? 40,
      highScore: policyRow?.jobHoppingHighScore ?? 65,
    }
    const capLinguistic = policyRow?.capLinguisticToMedium ?? true

    // 1) Детерминированный слой — частота смен.
    const tenure = computeJobHopping(
      Array.isArray(snapshot.experience) ? snapshot.experience : [],
      now.getTime(),
      jhPolicy,
    )

    // 2) Смысловой слой — LLM.
    // Источник текста: СЫРОЙ текст из документа (тот же, что скрининг) —
    // не восстановленный из структуры, а оригинальный из Docling/extractor.
    // Фолбэк на resumeToText(snapshot) для hh-кандидатов без документа.
    const docs = await db.select({ parsedContent: document.parsedContent, type: document.type })
      .from(document)
      .where(and(eq(document.candidateId, candidateId), eq(document.organizationId, organizationId)))
    const resumeDoc = docs.find(d => d.type === 'resume')
    let resumeText = extractResumeText(resumeDoc?.parsedContent)
    if (!resumeText || resumeText.trim().length < 30) {
      resumeText = resumeToText(snapshot as any)
    }
    const config = await loadAiConfig(organizationId, { purpose: 'analysis', preferId: null })
    const { object, usage, responseModel } = await assessResumeRisk(
      {
        provider: config.provider as SupportedProvider,
        model: config.model,
        apiKeyEncrypted: config.apiKeyEncrypted,
        baseUrl: config.baseUrl,
        maxTokens: config.maxTokens,
      },
      {
        currentDate: now,
        resumeText,
        tenure,
        policy: { extraInstructions: policyRow?.extraInstructions ?? null },
      },
    )

    // 3) Агрегация с cap (в коде, не LLM).
    const agg = aggregateRisk(
      object.findings.map(f => ({ severity: f.severity, confidence: f.confidence })),
      tenure,
      { capLinguisticToMedium: capLinguistic },
    )

    await db.update(resumeRisk)
      .set({
        status: 'completed',
        overallRisk: agg.overallRisk,
        overallScore: agg.overallScore,
        isCapped: agg.isCapped,
        summary: object.summary || null,
        tenureJson: tenure as unknown as Record<string, unknown>,
        findingsJson: { findings: object.findings } as unknown as Record<string, unknown>,
        metricsJson: object.metrics as unknown as Record<string, unknown>,
        provider: config.provider,
        model: responseModel ?? config.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        contentHash: version.contentHash,
        assessedAt: now,
        errorMessage: null,
      })
      .where(and(eq(resumeRisk.resumeVersionId, resumeVersionId), eq(resumeRisk.organizationId, organizationId)))

    logInfo('risk.completed', {
      candidate_id: candidateId,
      resume_version_id: resumeVersionId,
      overall_risk: agg.overallRisk,
      is_capped: agg.isCapped,
      findings: object.findings.length,
      duration_ms: Date.now() - startedAt,
      module: 'risk',
    })
  }
  catch (err) {
    await db.update(resumeRisk)
      .set({ status: 'failed', errorMessage: err instanceof Error ? err.message.slice(0, 500) : String(err) })
      .where(and(eq(resumeRisk.resumeVersionId, resumeVersionId), eq(resumeRisk.organizationId, organizationId)))
    logError('risk.job_failed', {
      candidate_id: candidateId,
      resume_version_id: resumeVersionId,
      error_message: err instanceof Error ? err.message : String(err),
      module: 'risk',
    })
    throw err
  }
}
