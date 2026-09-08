import { and, eq } from 'drizzle-orm'
import { document, candidate } from '../../../database/schema'
import { downloadFromS3 } from '../../../utils/s3'
import { parseDocument } from '../../../utils/resume-parser'
import { structureDocumentIntoVersion } from '../../../utils/resume-version/structure-from-document'

/**
 * POST /api/documents/:id/re-extract
 *
 * Re-extracts text from the original file (now with Docling fallback for complex
 * PDFs), updates document.parsedContent, and triggers re-structuring so the
 * candidate's resume version snapshot is rebuilt with the improved text.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: documentId } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1) }).parse)

  const doc = await db.query.document.findFirst({
    where: eq(document.id, documentId),
  })
  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Документ не найден' })
  }

  const cand = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, doc.candidateId), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })
  if (!cand) {
    throw createError({ statusCode: 404, statusMessage: 'Документ не найден' })
  }

  const buffer = await downloadFromS3(doc.storageKey)
  const parsed = await parseDocument(buffer, doc.mimeType, doc.originalFilename)
  if (!parsed) {
    throw createError({ statusCode: 422, statusMessage: 'Не удалось извлечь текст из файла' })
  }

  await db.update(document)
    .set({ parsedContent: parsed as any })
    .where(and(eq(document.id, documentId), eq(document.candidateId, doc.candidateId)))

  const restructureResult = await structureDocumentIntoVersion({
    orgId,
    candidateId: doc.candidateId,
    documentId,
    triggeredBy: session.user.id,
    forceRestructure: true,
  })

  return {
    documentId,
    candidateId: doc.candidateId,
    method: parsed.parserVersion,
    charCount: parsed.text.length,
    restructure: restructureResult,
  }
})
