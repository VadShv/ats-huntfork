import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidate } from '../../../../../database/schema'
import { parseHhResume } from '../../../../../utils/hh/resume-render'
import { structureDocumentIntoVersion } from '../../../../../utils/resume-version/structure-from-document'
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

  // Единая точка структурирования (та же, что и авто-версия при загрузке файла).
  // forceRestructure: ручной вызов кнопкой всегда перезапускает разбор.
  const res = await structureDocumentIntoVersion({
    orgId,
    candidateId: id,
    documentId: docId,
    triggeredBy: session.user.id,
    forceRestructure: true,
  })

  if (res.action === 'skipped_hh') {
    throw createError({
      statusCode: 409,
      statusMessage: 'У кандидата уже есть резюме с hh.ru — оно приоритетно и не перезаписывается структурированием из файла',
    })
  }
  if (res.action === 'insufficient_text') {
    throw createError({
      statusCode: 422,
      statusMessage: 'Из файла не удалось извлечь достаточно текста (возможно, это скан без текстового слоя)',
    })
  }
  if (res.action === 'failed') {
    throw createError({ statusCode: 422, statusMessage: `Не удалось структурировать резюме: ${res.reason ?? 'ошибка'}` })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'candidate',
    resourceId: id,
    metadata: { event: 'resume_structured', documentId: docId, versionNumber: res.versionNumber },
  })

  return {
    ok: true as const,
    candidateId: id,
    documentId: docId,
    versionNumber: res.versionNumber,
    resume: res.raw ? parseHhResume(res.raw) : null,
  }
})
