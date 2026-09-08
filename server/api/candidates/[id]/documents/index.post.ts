import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { candidate, document } from '../../../../database/schema'
import {
  MAX_FILE_SIZE,
  MAX_DOCUMENTS_PER_CANDIDATE,
  MIME_TO_EXTENSION,
  documentTypeSchema,
  sanitizeFilename,
  detectDocumentMime,
  isAllowedDocumentMime,
} from '../../../../utils/schemas/document'
import { parseDocument, convertToPdfViaService } from '../../../../utils/resume-parser'
import { refreshCandidateSearchTsv } from '../../../../utils/candidateSearchText'
import { structureDocumentIntoVersion } from '../../../../utils/resume-version/structure-from-document'

/**
 * POST /api/candidates/:id/documents
 *
 * Upload a document (resume, cover letter, etc.) for a candidate.
 * Accepts multipart/form-data with:
 *   - `file`: the document file (PDF, DOC, DOCX — max 10 MB)
 *   - `type`: document type ("resume" | "cover_letter" | "other")
 *
 * Security:
 *   - Auth required, org-scoped
 *   - Candidate ownership verified (candidate must belong to the authenticated org)
 *   - MIME type validated from file magic bytes (not just Content-Type header)
 *   - Storage key is server-generated (no user-controlled path components)
 *   - Per-candidate document limit enforced
 *   - Orphaned S3 objects cleaned up on DB insert failure
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { document: ['create'] })
  const orgId = session.session.activeOrganizationId

  // ─────────────────────────────────────────────
  // 1. Validate candidate exists and belongs to this org
  // ─────────────────────────────────────────────

  const { id: candidateId } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse)

  const existingCandidate = await db.query.candidate.findFirst({
    where: and(
      eq(candidate.id, candidateId),
      eq(candidate.organizationId, orgId),
    ),
    columns: { id: true, hhResumeId: true },
  })

  if (!existingCandidate) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  // ─────────────────────────────────────────────
  // 2. Read multipart form data
  // ─────────────────────────────────────────────

  const formData = await readMultipartFormData(event)
  if (!formData) {
    throw createError({ statusCode: 400, statusMessage: 'Данные формы не получены' })
  }

  const filePart = formData.find((part) => part.name === 'file')
  const typePart = formData.find((part) => part.name === 'type')

  if (!filePart || !filePart.data || !filePart.filename) {
    throw createError({ statusCode: 400, statusMessage: 'Файл не выбран' })
  }

  // ─────────────────────────────────────────────
  // 3. Validate document type
  // ─────────────────────────────────────────────

  // Флаг «нестандартный формат резюме» из формы → структурируем только сильным LLM.
  const nonStandardPart = formData.find((part) => part.name === 'nonStandard')
  const nonStandard = (nonStandardPart?.data?.toString() ?? '') === 'true'

  const typeValue = typePart?.data?.toString() ?? 'resume'
  const typeResult = documentTypeSchema.safeParse(typeValue)
  if (!typeResult.success) {
    throw createError({ statusCode: 400, statusMessage: 'Некорректный тип документа. Допустимые значения: resume, cover_letter, other' })
  }
  const documentType = typeResult.data

  // ─────────────────────────────────────────────
  // 4. Validate file size
  // ─────────────────────────────────────────────

  const fileBuffer = filePart.data
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw createError({
      statusCode: 413,
      statusMessage: `Файл слишком большой. Максимальный размер: ${MAX_FILE_SIZE / 1024 / 1024} МБ`,
    })
  }

  // ─────────────────────────────────────────────
  // 5. Validate MIME type from magic bytes (not just Content-Type header)
  //    Uses the shared detector so legacy .doc (OLE2 / x-cfb) is handled
  //    consistently across every upload endpoint.
  // ─────────────────────────────────────────────

  const mimeType = await detectDocumentMime(fileBuffer)

  if (!isAllowedDocumentMime(mimeType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Некорректный тип файла. Допустимые форматы: PDF, DOC, DOCX',
    })
  }

  // ─────────────────────────────────────────────
  // 6. Check per-candidate document limit
  // ─────────────────────────────────────────────

  const existingDocCount = await db.$count(
    document,
    and(
      eq(document.candidateId, candidateId),
      eq(document.organizationId, orgId),
    ),
  )

  if (existingDocCount >= MAX_DOCUMENTS_PER_CANDIDATE) {
    throw createError({
      statusCode: 409,
      statusMessage: `Достигнут лимит документов: максимум ${MAX_DOCUMENTS_PER_CANDIDATE} на кандидата`,
    })
  }

  // ─────────────────────────────────────────────
  // 7. Generate safe storage key and upload to S3
  // ─────────────────────────────────────────────

  const documentId = crypto.randomUUID()
  const extension = MIME_TO_EXTENSION[mimeType] ?? 'bin'
  const storageKey = `${orgId}/${candidateId}/${documentId}.${extension}`

  await uploadToS3(storageKey, fileBuffer, mimeType)

  // ─────────────────────────────────────────────
  // 7.1 Derived PDF preview for non-PDF docs (DOC/DOCX → PDF via LibreOffice)
  //     Best-effort: если конвертация недоступна/упала — просто нет превью,
  //     загрузка не блокируется (UI предложит скачать оригинал).
  // ─────────────────────────────────────────────

  let previewStorageKey: string | null = null
  if (mimeType !== 'application/pdf') {
    try {
      const pdf = await convertToPdfViaService(fileBuffer, mimeType, filePart.filename)
      if (pdf) {
        const key = `${orgId}/${candidateId}/${documentId}.preview.pdf`
        await uploadToS3(key, pdf, 'application/pdf')
        previewStorageKey = key
      }
    }
    catch (convErr) {
      logWarn('document.preview_convert_failed', {
        document_id: documentId,
        error_message: convErr instanceof Error ? convErr.message : String(convErr),
      })
    }
  }

  // ─────────────────────────────────────────────
  // 8. Parse document content (best-effort — does not block upload)
  // ─────────────────────────────────────────────

  const parsedContent = await parseDocument(fileBuffer, mimeType, filePart.filename)

  // ─────────────────────────────────────────────
  // 9. Insert DB record — clean up S3 on failure
  // ─────────────────────────────────────────────

  try {
    const [created] = await db.insert(document).values({
      id: documentId,
      organizationId: orgId,
      candidateId,
      type: documentType,
      storageKey,
      previewStorageKey,
      originalFilename: sanitizeFilename(filePart.filename),
      mimeType,
      sizeBytes: fileBuffer.length,
      parsedContent: parsedContent as any,
    }).returning({
      id: document.id,
      type: document.type,
      originalFilename: document.originalFilename,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      createdAt: document.createdAt,
    })

    if (!created) {
      throw createError({ statusCode: 500, statusMessage: 'Не удалось создать документ' })
    }

    recordActivity({
      organizationId: orgId,
      actorId: session.user.id,
      action: 'created',
      resourceType: 'document',
      resourceId: created.id,
      metadata: { candidateId, filename: created.originalFilename, type: created.type },
    })

    // Sprint 11: обновляем full-text индекс поиска в фоне (не блокируем ответ).
    refreshCandidateSearchTsv({ orgId, candidateId }).catch((err) => {
      logWarn('candidate.search_tsv_refresh_failed', {
        candidate_id: candidateId,
        error_message: err instanceof Error ? err.message : String(err),
      })
    })

    // Мастер-профиль: загруженное резюме автоматически становится новой версией.
    // Запускаем структурирование в фоне (best-effort) — только для resume-файлов
    // с извлечённым текстом и при отсутствии приоритетного hh-снепшота.
    const parsedText = (parsedContent as { text?: string } | null)?.text?.trim() ?? ''
    const resumeVersioningStarted
      = documentType === 'resume' && !existingCandidate.hhResumeId && parsedText.length >= 200
    if (resumeVersioningStarted) {
      structureDocumentIntoVersion({
        orgId,
        candidateId,
        documentId: created.id,
        triggeredBy: session.user.id,
        forceLlm: nonStandard,
      }).then((res) => {
        if (res.action === 'created') {
          recordActivity({
            organizationId: orgId,
            actorId: session.user.id,
            action: 'updated',
            resourceType: 'candidate',
            resourceId: candidateId,
            metadata: { event: 'resume_version_auto', documentId: created.id, versionNumber: res.versionNumber },
          })
        }
        else if (res.action === 'failed') {
          logWarn('candidate.resume_auto_version_failed', {
            candidate_id: candidateId, document_id: created.id, error_message: res.reason ?? 'unknown',
          })
        }
      }).catch((err) => {
        logWarn('candidate.resume_auto_version_failed', {
          candidate_id: candidateId, document_id: created.id,
          error_message: err instanceof Error ? err.message : String(err),
        })
      })
    }

    setResponseStatus(event, 201)
    return { ...created, resumeVersioningStarted }
  } catch (dbError) {
    // Clean up the orphaned S3 objects if DB insert fails (original + preview)
    for (const key of [storageKey, previewStorageKey].filter(Boolean) as string[]) {
      try {
        await deleteFromS3(key)
      } catch (cleanupError) {
        logWarn('document.s3_orphan_cleanup_failed', {
          storage_key: key,
          error_message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        })
      }
    }
    throw dbError
  }
})
