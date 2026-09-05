import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidate, document } from '../../../../database/schema'
import { structureDocumentIntoVersion } from '../../../../utils/resume-version/structure-from-document'

const paramsSchema = z.object({ id: z.string().min(1) })
const bodySchema = z.object({ documentId: z.string().uuid() })

/**
 * POST /api/candidates/:id/resume-versions/attach-document
 *
 * Прикрепляет ранее загруженный документ-резюме к ЭТОМУ кандидату и делает его
 * новой версией резюме. Используется, когда при загрузке резюме система (или
 * рекрутер) определила, что это резюме уже существующего кандидата, — тогда мы не
 * плодим дубль, а добавляем версию в его мастер-профиль.
 *
 * Документ переносится (candidate_id := :id), затем структурируется в версию.
 * Права: candidate:update.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { documentId } = await readValidatedBody(event, bodySchema.parse)

  // Целевой кандидат принадлежит org.
  const cand = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true, hhResumeId: true },
  })
  if (!cand) throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  if (cand.hhResumeId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'У кандидата есть резюме с hh.ru — оно приоритетно и не перезаписывается из файла',
    })
  }

  // Документ существует в org и является резюме.
  const doc = await db.query.document.findFirst({
    where: and(eq(document.id, documentId), eq(document.organizationId, orgId)),
    columns: { id: true, type: true, candidateId: true },
  })
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Документ не найден' })
  if (doc.type !== 'resume') {
    throw createError({ statusCode: 422, statusMessage: 'Прикрепить как версию можно только документ типа «Резюме»' })
  }

  // Переносим документ на целевого кандидата (если ещё не его).
  if (doc.candidateId !== id) {
    await db.update(document)
      .set({ candidateId: id })
      .where(and(eq(document.id, documentId), eq(document.organizationId, orgId)))
  }

  const res = await structureDocumentIntoVersion({
    orgId,
    candidateId: id,
    documentId,
    triggeredBy: session.user.id,
  })

  if (res.action === 'failed' || res.action === 'insufficient_text') {
    throw createError({
      statusCode: 422,
      statusMessage: res.action === 'insufficient_text'
        ? 'Из документа не удалось извлечь достаточно текста'
        : `Не удалось структурировать резюме: ${res.reason ?? 'ошибка'}`,
    })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'candidate',
    resourceId: id,
    metadata: { event: 'resume_version_attached', documentId, versionNumber: res.versionNumber },
  })

  return { ok: true as const, candidateId: id, documentId, action: res.action, versionNumber: res.versionNumber }
})
