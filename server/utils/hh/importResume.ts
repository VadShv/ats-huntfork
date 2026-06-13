/**
 * Унифицированный импорт резюме из hh.ru в Huntfork.
 *
 * Используется:
 *   • hh-sync (server/utils/hh/sync.ts) — когда импортим отклики
 *   • Chrome Extension (server/api/extension/import.post.ts) — когда рекрутёр
 *     вручную добавляет резюме при сорсинге
 *
 * Контракт: даёт ТОТ ЖЕ candidate + hh_resume_raw + candidate_resume_version,
 * что и при импорте отклика. Это гарантирует, что вся остальная логика приложения
 * (рендер резюме, AI-summary, дедуп, поиск) работает одинаково независимо от
 * источника.
 *
 * Что НЕ делает (по задумке):
 *   • не создаёт hh_negotiation (это сущность для синхронизации откликов, не для сорсинга)
 *   • не вызывает auto-scoring (его триггерит вызывающий код, если нужно)
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import {
  application, applicationStageHistory, candidate, document, hhAccount, job,
} from '../../database/schema'
import { apiGet } from './client'
import { getValidAccessToken } from './tokens'
import { extractContacts, resumeToText, type HhResumeApi } from './sync'
import { extractIdentitiesFromHhResume } from '../dedup/extract'
import {
  getOrgGroupId, resolveCandidateBySignals, upsertCandidateIdentities,
} from '../dedup/resolve'
import { appendResumeVersionIfChanged } from '../resume-version/append'
import { enqueueFuzzyDetect } from '../dedup/workers/fuzzy-job'
import { getEntryStageForPipeline } from '../pipeline-helpers'

export interface ImportResumeParams {
  organizationId: string
  resumeId: string                  // hh resume hash (из URL hh.ru/resume/{hash})
  /** Если передан — создаём application для этой вакансии */
  jobId?: string
  /** Источник для application.source. По умолчанию 'hh' */
  source?: 'hh' | 'hh-extension' | 'manual'
  /** Кто инициировал импорт (для логов и аудита, не сохраняется в БД) */
  triggeredByUserId?: string
}

export interface ImportResumeResult {
  candidateId: string
  applicationId?: string
  /** true, если candidate был создан в этом вызове, false — если найден существующий */
  candidateCreated: boolean
  /** true, если application был создан (или уже существовал, если applicationCreated=false) */
  applicationCreated?: boolean
  hhResumeId: string
  /** Текущее состояние candidate для UI */
  candidate: {
    id: string
    firstName: string
    lastName: string
    email: string
    phone: string | null
  }
}

export class ImportResumeError extends Error {
  code: 'NO_HH_ACCOUNT' | 'HH_API_FAILED' | 'JOB_NOT_FOUND' | 'UNKNOWN'
  constructor(code: ImportResumeError['code'], message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Достаёт OAuth-токен для организации. Берёт первый активный hh_account.
 */
async function getOrgHhToken(organizationId: string): Promise<string> {
  const accounts = await db
    .select({ id: hhAccount.id })
    .from(hhAccount)
    .where(eq(hhAccount.organizationId, organizationId))
    .limit(1)
  if (accounts.length === 0) {
    throw new ImportResumeError('NO_HH_ACCOUNT', 'hh.ru не подключен для этой организации')
  }
  return getValidAccessToken(accounts[0]!.id)
}

/**
 * Импорт резюме по resumeId. См. модульный комментарий.
 */
export async function importResumeFromHh(params: ImportResumeParams): Promise<ImportResumeResult> {
  const { organizationId, resumeId, jobId, source = 'hh-extension' } = params

  // 1) Качаем резюме через тот же канал, что и sync (org-токен hh)
  const token = await getOrgHhToken(organizationId)
  let resume: HhResumeApi
  try {
    resume = await apiGet<HhResumeApi>(`/resumes/${resumeId}`, token)
  }
  catch (err) {
    throw new ImportResumeError(
      'HH_API_FAILED',
      `hh.ru API не вернул резюме: ${(err as Error).message}`,
    )
  }

  const { email: hhEmail, phone } = extractContacts(resume)
  const fallbackEmail = hhEmail || `hh-${resumeId}@no-email.huntfork.local`
  const firstName = resume.first_name || 'Кандидат'
  const lastName = resume.last_name || `hh#${resumeId.slice(-6)}`

  // 2) Резолвим candidate по identity-сигналам
  const identitySignals = extractIdentitiesFromHhResume(resume as unknown as Record<string, unknown>)
  const groupId = await getOrgGroupId(organizationId)
  const resolved = await resolveCandidateBySignals(groupId, identitySignals)

  const resumeSnapshot = {
    hhResumeId: resumeId,
    hhResumeRaw: resume as unknown as Record<string, unknown>,
    hhResumeFetchedAt: new Date(),
  }

  let candidateId: string
  let candidateCreated = false

  if (resolved.candidateId) {
    candidateId = resolved.candidateId
    await db.update(candidate).set({
      hhResumeId: resumeSnapshot.hhResumeId,
      hhResumeRaw: resumeSnapshot.hhResumeRaw,
      hhResumeFetchedAt: resumeSnapshot.hhResumeFetchedAt,
      ...(phone ? { phone } : {}),
      updatedAt: new Date(),
    }).where(eq(candidate.id, candidateId))
    if (resolved.hasConflict) {
      console.warn('[hh:import] identity conflict', { picked: candidateId, matches: resolved.matches })
    }
  }
  else {
    // Fallback: ищем по (org, email)
    const existingCand = await db
      .select({ id: candidate.id })
      .from(candidate)
      .where(and(
        eq(candidate.organizationId, organizationId),
        eq(candidate.email, fallbackEmail),
      ))
      .limit(1)
    if (existingCand.length > 0) {
      candidateId = existingCand[0]!.id
      await db.update(candidate).set({
        hhResumeId: resumeSnapshot.hhResumeId,
        hhResumeRaw: resumeSnapshot.hhResumeRaw,
        hhResumeFetchedAt: resumeSnapshot.hhResumeFetchedAt,
        ...(phone ? { phone } : {}),
        updatedAt: new Date(),
      }).where(eq(candidate.id, candidateId))
    }
    else {
      const insCand = await db.insert(candidate).values({
        organizationId,
        firstName,
        lastName,
        email: fallbackEmail,
        phone: phone ?? null,
        hhResumeId: resumeSnapshot.hhResumeId,
        hhResumeRaw: resumeSnapshot.hhResumeRaw,
        hhResumeFetchedAt: resumeSnapshot.hhResumeFetchedAt,
      }).returning({ id: candidate.id })
      candidateId = insCand[0]!.id
      candidateCreated = true
    }
  }

  // 3) Identity-сигналы — апдейт
  if (identitySignals.length > 0) {
    await upsertCandidateIdentities({
      candidateId,
      organizationId,
      groupId,
      signals: identitySignals,
    })
  }

  // 4) Версионирование резюме (best-effort)
  try {
    const hhUpdatedAtRaw = (resume as { updated_at?: string }).updated_at
    const hhUpdatedAt = hhUpdatedAtRaw ? new Date(hhUpdatedAtRaw) : null
    await appendResumeVersionIfChanged({
      candidateId,
      raw: resume as unknown as Record<string, unknown>,
      source: 'hh',
      triggeredBy: source === 'hh-extension' ? 'extension' : 'manual',
      hhUpdatedAt: hhUpdatedAt && !isNaN(hhUpdatedAt.getTime()) ? hhUpdatedAt : null,
    })
  }
  catch (err) {
    console.warn('[hh:import] resume versioning failed', { candidateId, err: (err as Error).message })
  }

  // 5) Fuzzy-дедуп в фоне для новых
  if (candidateCreated) {
    void enqueueFuzzyDetect({
      candidateId,
      organizationId,
      includeOtherOrgs: true,
    })
  }

  // 6) document — для AI-поиска по тексту
  const storageKey = `hh://resume/${resumeId}`
  const existingDoc = await db
    .select({ id: document.id })
    .from(document)
    .where(eq(document.storageKey, storageKey))
    .limit(1)
  if (existingDoc.length === 0) {
    const resumeText = resumeToText(resume)
    await db.insert(document).values({
      organizationId,
      candidateId,
      type: 'resume',
      storageKey,
      originalFilename: `hh-resume-${resumeId}.json`,
      mimeType: 'application/json',
      parsedContent: { text: resumeText, source: 'hh.ru', resumeId } as unknown,
    })
  }

  // 7) Опциональный application (если передан jobId)
  let applicationId: string | undefined
  let applicationCreated: boolean | undefined
  if (jobId) {
    const existingApp = await db
      .select({ id: application.id })
      .from(application)
      .where(and(
        eq(application.organizationId, organizationId),
        eq(application.candidateId, candidateId),
        eq(application.jobId, jobId),
      ))
      .limit(1)

    if (existingApp.length > 0) {
      applicationId = existingApp[0]!.id
      applicationCreated = false
      // обновим source/externalUrl если ещё пустые
      await db.update(application).set({
        source,
        externalId: resumeId,
        externalUrl: resume.alternate_url ?? null,
        updatedAt: new Date(),
      }).where(eq(application.id, applicationId))
    }
    else {
      // Узнаём entry stage пайплайна вакансии
      const jobRows = await db
        .select({ pipelineId: job.pipelineId })
        .from(job)
        .where(eq(job.id, jobId))
        .limit(1)
      let entryStageId: string | null = null
      if (jobRows[0]?.pipelineId) {
        const entry = await getEntryStageForPipeline(db, jobRows[0].pipelineId)
        entryStageId = entry?.id ?? null
      }

      const insApp = await db.insert(application).values({
        organizationId,
        candidateId,
        jobId,
        status: 'new',
        currentStageId: entryStageId,
        stageChangedAt: entryStageId ? new Date() : null,
        source,
        externalId: resumeId,
        externalUrl: resume.alternate_url ?? null,
      }).returning({ id: application.id })
      applicationId = insApp[0]!.id
      applicationCreated = true

      if (entryStageId) {
        try {
          await db.insert(applicationStageHistory).values({
            organizationId,
            applicationId,
            fromStageId: null,
            toStageId: entryStageId,
            movedByUserId: params.triggeredByUserId ?? null,
            movedAt: new Date(),
          })
        }
        catch { /* best-effort */ }
      }
    }
  }

  return {
    candidateId,
    applicationId,
    candidateCreated,
    applicationCreated,
    hhResumeId: resumeId,
    candidate: {
      id: candidateId,
      firstName,
      lastName,
      email: fallbackEmail,
      phone: phone ?? null,
    },
  }
}
