import { eq, and } from 'drizzle-orm'
import { document } from '../../../database/schema'
import { z } from 'zod'

const paramsSchema = z.object({ id: z.string().min(1) })

/**
 * GET /api/documents/:id/parsed
 *
 * Returns the stored parsedContent (extracted text, sections, metadata)
 * for a document. Read-only — no re-parsing (text is already in the DB
 * from upload time or a prior POST /parse call).
 *
 * Security: auth required, org-scoped, document must belong to the org.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { document: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id: documentId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const doc = await db.query.document.findFirst({
    where: and(
      eq(document.id, documentId),
      eq(document.organizationId, orgId),
    ),
    columns: {
      id: true,
      originalFilename: true,
      mimeType: true,
      parsedContent: true,
    },
  })

  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Документ не найден' })
  }

  if (!doc.parsedContent) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Текст ещё не извлечён. Нажмите «Перепарсить» для повторной обработки.',
    })
  }

  return doc.parsedContent
})
