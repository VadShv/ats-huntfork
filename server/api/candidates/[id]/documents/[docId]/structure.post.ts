import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidate, document } from '../../../../../database/schema'
import { structureResumeFromText, buildHhCompatibleRaw } from '../../../../../utils/ai/structureResume'
import { parseHhResume } from '../../../../../utils/hh/resume-render'
import { appendResumeVersionIfChanged } from '../../../../../utils/resume-version/append'
import { refreshCandidateSearchTsv } from '../../../../../utils/candidateSearchText'
import { createRateLimiter } from '../../../../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  message: 'Слишком много запросов на структурирование резюме. Подождите немного',
})

const paramsSchema = z.object({
  id: z.string().min(1),
  docId: z.string().uuid(),
})

/**
 * POST /api/candidates/:id/documents/:docId/structure
 *
 * Структурирует загруженный файл резюме (PDF/DOC/DOCX) в hh-совместимый JSON
 * и сохраняет его в candidate.hh_resume_raw — карточка кандидата получает
 * тот же вид, что у кандидатов с hh.ru (единообразие для всех источников).
 *
 * Правила:
 *   - вызывается вручную кнопкой в карточке (токены LLM тратятся осознанно);
 *   - настоящий hh-снепшот (hh_resume_id != null) приоритетен — 409;
 *   - повторное структурирование из файла разрешено (перезапись document_parse);
 *   - документ должен быть типа 'resume' и иметь извлечённый текст.
 */
export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id, docId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const row = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true, hhResumeId: true },
  })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })

  // Настоящее hh-резюме — авторитетный источник, его не перезаписываем разбором файла.
  if (row.hhResumeId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'У кандидата уже есть резюме с hh.ru — оно приоритетно и не перезаписывается структурированием из файла',
    })
  }

  const doc = await db.query.document.findFirst({
    where: and(
      eq(document.id, docId),
      eq(document.candidateId, id),
      eq(document.organizationId, orgId),
    ),
    columns: { id: true, type: true, originalFilename: true, parsedContent: true },
  })
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Документ не найден' })
  if (doc.type !== 'resume') {
    throw createError({ statusCode: 422, statusMessage: 'Структурировать можно только документ типа «Резюме»' })
  }

  const text = (doc.parsedContent as { text?: string } | null)?.text?.trim() ?? ''
  if (text.length < 200) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Из файла не удалось извлечь достаточно текста (возможно, это скан без текстового слоя)',
    })
  }

  const { parsed, config } = await structureResumeFromText({ orgId, text })

  const raw = buildHhCompatibleRaw(parsed, {
    documentId: doc.id,
    sourceFilename: doc.originalFilename,
    provider: (config as { provider?: string }).provider ?? null,
    model: (config as { model?: string }).model ?? null,
  })

  await db.update(candidate)
    .set({ hhResumeRaw: raw, hhResumeFetchedAt: new Date() })
    .where(and(eq(candidate.id, id), eq(candidate.organizationId, orgId)))

  // Версия резюме — тем же конвейером, что и hh-синк (source: manual_upload).
  await appendResumeVersionIfChanged({
    candidateId: id,
    raw,
    source: 'manual_upload',
    triggeredBy: session.user.id,
    bypassDebounce: true,
  }).catch((err) => {
    logWarn('resume_structure.version_append_failed', {
      candidate_id: id,
      error_message: err instanceof Error ? err.message : String(err),
    })
  })

  // Полнотекстовый поиск — в фоне, не блокируем ответ.
  refreshCandidateSearchTsv({ orgId, candidateId: id }).catch((err) => {
    logWarn('resume_structure.search_tsv_refresh_failed', {
      candidate_id: id,
      error_message: err instanceof Error ? err.message : String(err),
    })
  })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'candidate',
    resourceId: id,
    metadata: { event: 'resume_structured', documentId: doc.id, filename: doc.originalFilename },
  })

  return {
    ok: true as const,
    candidateId: id,
    documentId: doc.id,
    resume: parseHhResume(raw),
  }
})
