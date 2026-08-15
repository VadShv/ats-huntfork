/**
 * POST /api/extension/capture-confirm
 *
 * Второй шаг Universal Capture: рекрутёр отредактировал черновик в панели
 * Sidekick и подтвердил сохранение. Создаём кандидата тем же конвейером,
 * что hh-импорт и ручное создание:
 *   candidate + hh_resume_raw (hh-совместимый, _hf.source='extension_capture')
 *   + candidate_identity + версия резюме + fuzzy-детект в фоне
 *   + full-text реиндекс + activity + (опц.) application с entry-стадией воронки.
 *
 * Дедуп-политика (та же, что при ручном создании):
 *   - точное совпадение email/телефона → 409 duplicate_exact (force не помогает);
 *   - fuzzy ≥95 или совпадение по соцсетям → 409, обходится force=true.
 *
 * Body: { parsed: StructuredResume, contacts?, sourceUrl, site?, provider?, model?,
 *         jobId?, force? }
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import {
  application, applicationStageHistory, candidate, candidateIdentity, job,
} from '../../database/schema'
import { buildHhCompatibleRaw, structuredResumeSchema } from '../../utils/ai/structureResume'
import { refreshCandidateSearchTsv } from '../../utils/candidateSearchText'
import { findDuplicatesForDraft } from '../../utils/dedup/check'
import { extractIdentitiesFromCandidateRow } from '../../utils/dedup/extract'
import {
  normalizeGithub, normalizeLinkedinUrl, normalizeTelegram,
} from '../../utils/dedup/normalize'
import { getOrgGroupId, upsertCandidateIdentities } from '../../utils/dedup/resolve'
import { enqueueFuzzyDetect } from '../../utils/dedup/workers/fuzzy-job'
import { getEntryStageForPipeline } from '../../utils/pipeline-helpers'
import { createRateLimiter } from '../../utils/rateLimit'
import { appendResumeVersionIfChanged } from '../../utils/resume-version/append'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: 'Слишком много сохранений подряд. Подождите немного',
})

const bodySchema = z.object({
  parsed: structuredResumeSchema,
  contacts: z.object({
    email: z.string().max(200).nullish(),
    phone: z.string().max(50).nullish(),
    telegram: z.string().max(100).nullish(),
    linkedin: z.string().max(500).nullish(),
    github: z.string().max(500).nullish(),
  }).optional(),
  sourceUrl: z.string().url().max(2000),
  site: z.string().max(40).optional(),
  provider: z.string().max(100).nullish(),
  model: z.string().max(100).nullish(),
  jobId: z.string().min(1).optional(),
  force: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const body = await readValidatedBody(event, bodySchema.parse)
  const { parsed } = body
  const force = body.force === true

  const firstName = parsed.firstName?.trim() ?? ''
  const lastName = parsed.lastName?.trim() ?? ''
  if (!firstName && !lastName) {
    throw createError({ statusCode: 400, statusMessage: 'Укажите имя или фамилию кандидата' })
  }

  const email = body.contacts?.email?.trim() || null
  const phone = body.contacts?.phone?.trim() || null
  const telegram = body.contacts?.telegram?.trim() || null
  const linkedin = body.contacts?.linkedin?.trim() || null
  const github = body.contacts?.github?.trim() || null

  // ─── 1. Дедуп ровно по той же политике, что ручное создание кандидата.
  const dupes = await findDuplicatesForDraft(orgId, {
    firstName,
    lastName,
    email,
    phone,
    city: parsed.area || null,
  })
  if (dupes.exact.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'duplicate_exact',
      data: {
        code: 'duplicate_exact',
        message: 'Кандидат с таким email или телефоном уже существует',
        exact: dupes.exact,
        fuzzy: dupes.fuzzy,
      },
    })
  }
  const hardFuzzy = dupes.fuzzy.filter(f => f.score >= 95)
  if (hardFuzzy.length > 0 && !force) {
    throw createError({
      statusCode: 409,
      statusMessage: 'duplicate_fuzzy',
      data: {
        code: 'duplicate_fuzzy',
        message: 'Похоже, кандидат уже есть в базе',
        exact: [],
        fuzzy: dupes.fuzzy,
      },
    })
  }

  // Совпадение по соцсетям (candidate_identity) — «этот профиль уже захватывали».
  if (!force) {
    const socialConds = [
      { kind: 'linkedin', v: normalizeLinkedinUrl(linkedin) },
      { kind: 'telegram', v: normalizeTelegram(telegram) },
      { kind: 'github', v: normalizeGithub(github) },
    ].filter((x): x is { kind: string, v: string } => !!x.v)
    if (socialConds.length > 0) {
      const groupId = await getOrgGroupId(orgId)
      for (const sc of socialConds) {
        const scope = groupId
          ? eq(candidateIdentity.groupId, groupId)
          : eq(candidateIdentity.organizationId, orgId)
        const hit = await db
          .select({ candidateId: candidateIdentity.candidateId })
          .from(candidateIdentity)
          .where(and(
            scope,
            eq(candidateIdentity.kind, sc.kind),
            eq(candidateIdentity.valueNormalized, sc.v),
          ))
          .limit(1)
        if (hit.length > 0) {
          throw createError({
            statusCode: 409,
            statusMessage: 'duplicate_social',
            data: {
              code: 'duplicate_social',
              message: `Кандидат с таким профилем (${sc.kind}) уже есть в базе`,
              social: [{ kind: sc.kind, candidateId: hit[0]!.candidateId }],
            },
          })
        }
      }
    }
  }

  // ─── 2. Email обязателен в схеме — детерминированный fallback как у hh-импорта
  // (hh-${resumeId}@no-email...): повторный захват той же страницы того же
  // человека упрётся в дедуп по email, а не создаст дубль.
  const fallbackHash = createHash('sha1')
    .update(`${body.sourceUrl}|${firstName.toLowerCase()}|${lastName.toLowerCase()}`)
    .digest('hex')
    .slice(0, 16)
  const finalEmail = email || `capture-${fallbackHash}@no-email.huntfork.local`

  // ─── 3. hh-совместимый raw — карточка выглядит как у кандидатов с hh.ru.
  const raw = buildHhCompatibleRaw(parsed, {
    source: 'extension_capture',
    sourceUrl: body.sourceUrl,
    site: body.site ?? 'generic',
    provider: body.provider ?? null,
    model: body.model ?? null,
  })

  // ─── 4. Создаём кандидата.
  const [created] = await db.insert(candidate).values({
    organizationId: orgId,
    firstName: firstName || '—',
    lastName: lastName || '',
    email: finalEmail,
    phone,
    gender: parsed.gender !== 'unknown' ? parsed.gender : null,
    dateOfBirth: parsed.birthDate || null,
    city: parsed.area || null,
    linkedin,
    telegram,
    github,
    hhResumeRaw: raw,
    hhResumeFetchedAt: new Date(),
  }).returning({
    id: candidate.id,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
  })
  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось создать кандидата' })
  }
  const candidateId = created.id

  // ─── 5. Identity-записи для дедупа (email/phone/linkedin/telegram/github).
  const signals = extractIdentitiesFromCandidateRow({
    email: email, // fallback-email в identity не пишем — это не настоящий контакт
    phone,
    linkedin,
    telegram,
    github,
  })
  const groupId = await getOrgGroupId(orgId)
  if (signals.length > 0) {
    try {
      await upsertCandidateIdentities({ candidateId, organizationId: orgId, groupId, signals })
    }
    catch (e) {
      console.error('[ext:capture-confirm] upsertCandidateIdentities failed:', e)
    }
  }

  // ─── 6. Версия резюме — тем же конвейером, что hh-синк и разбор файлов.
  await appendResumeVersionIfChanged({
    candidateId,
    raw,
    source: 'manual_upload',
    triggeredBy: userId,
    bypassDebounce: true,
  }).catch((err) => {
    logWarn('ext_capture.version_append_failed', {
      candidate_id: candidateId,
      error_message: err instanceof Error ? err.message : String(err),
    })
  })

  // ─── 7. Fuzzy-детект в фоне (pg-boss) — как при ручном создании.
  void enqueueFuzzyDetect({ candidateId, organizationId: orgId, includeOtherOrgs: !!groupId })

  // ─── 8. Опциональная заявка на вакансию (семантика идентична hh-импорту).
  let applicationId: string | undefined
  let applicationCreated: boolean | undefined
  if (body.jobId) {
    const jobRows = await db
      .select({ pipelineId: job.pipelineId })
      .from(job)
      .where(and(eq(job.id, body.jobId), eq(job.organizationId, orgId)))
      .limit(1)
    if (jobRows.length === 0) {
      throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
    }
    let entryStageId: string | null = null
    if (jobRows[0]!.pipelineId) {
      const entry = await getEntryStageForPipeline(db, jobRows[0]!.pipelineId)
      entryStageId = entry?.id ?? null
    }
    const insApp = await db.insert(application).values({
      organizationId: orgId,
      candidateId,
      jobId: body.jobId,
      status: 'new',
      currentStageId: entryStageId,
      stageChangedAt: entryStageId ? new Date() : null,
      source: 'extension-capture',
      externalUrl: body.sourceUrl,
    }).returning({ id: application.id })
    applicationId = insApp[0]!.id
    applicationCreated = true
    if (entryStageId) {
      try {
        await db.insert(applicationStageHistory).values({
          organizationId: orgId,
          applicationId,
          fromStageId: null,
          toStageId: entryStageId,
          movedByUserId: userId,
          movedAt: new Date(),
        })
      }
      catch { /* best-effort */ }
    }
  }

  // ─── 9. Full-text реиндекс в фоне + активность.
  refreshCandidateSearchTsv({ orgId, candidateId }).catch((err) => {
    logWarn('ext_capture.search_tsv_refresh_failed', {
      candidate_id: candidateId,
      error_message: err instanceof Error ? err.message : String(err),
    })
  })

  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'created',
    resourceType: 'candidate',
    resourceId: candidateId,
    metadata: {
      name: [created.firstName, created.lastName].filter(Boolean).join(' '),
      source: 'extension_capture',
      site: body.site ?? 'generic',
      sourceUrl: body.sourceUrl,
      forced: force,
    },
  })

  trackEvent(event, session, 'candidate created', {
    candidate_id: candidateId,
    source: 'extension_capture',
    forced: force,
  })

  logApiRequest(event, session, 'extension.capture_confirm', {
    candidate_id: candidateId,
    site: body.site ?? 'generic',
    application_created: !!applicationCreated,
  })

  return {
    ok: true as const,
    candidateId,
    applicationId,
    applicationCreated,
    candidateCreated: true as const,
    candidateName: [created.firstName, created.lastName].filter(Boolean).join(' '),
  }
})
