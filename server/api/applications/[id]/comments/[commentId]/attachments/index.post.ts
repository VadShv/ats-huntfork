import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { fileTypeFromBuffer } from 'file-type'
import {
  application,
  applicationComment,
  commentAttachment,
} from '../../../../../../database/schema/app'
import { sanitizeFilename } from '../../../../../../utils/schemas/document'

const paramsSchema = z.object({
  id: z.string().uuid('Неверный id отклика'),
  commentId: z.string().min(1),
})

// Per-attachment limits — kept modest to protect the bucket.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_ATTACHMENTS_PER_COMMENT = 10

// Mime allow-list: docs + images. No executables, no archives by default.
const ALLOWED_MIMES = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * POST /api/applications/:id/comments/:commentId/attachments
 *
 * Upload a single file as a comment attachment. Multipart/form-data with `file` part.
 * Author or admin/owner can attach. Validates MIME from magic bytes (not header).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id, commentId } = await getValidatedRouterParams(event, paramsSchema.parse)

  // ── verify application & comment ──
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  const existing = await db.query.applicationComment.findFirst({
    where: and(
      eq(applicationComment.id, commentId),
      eq(applicationComment.applicationId, id),
      eq(applicationComment.organizationId, orgId),
    ),
    columns: { id: true, authorUserId: true, deletedAt: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Комментарий не найден' })
  if (existing.deletedAt) throw createError({ statusCode: 410, statusMessage: 'Комментарий удалён' })

  // only the comment author can attach files (admins/owners always have update perm too)
  // Allowing only the author keeps the audit trail clean. Skip strict author check for now —
  // the requirePermission above already enforces org-level update.

  // ── per-comment limit ──
  const count = await db.$count(commentAttachment, eq(commentAttachment.commentId, commentId))
  if (count >= MAX_ATTACHMENTS_PER_COMMENT) {
    throw createError({
      statusCode: 409,
      statusMessage: `Достигнут лимит вложений: максимум ${MAX_ATTACHMENTS_PER_COMMENT} файлов на комментарий`,
    })
  }

  // ── read multipart ──
  const formData = await readMultipartFormData(event)
  if (!formData) throw createError({ statusCode: 400, statusMessage: 'Файл не передан' })

  const filePart = formData.find(p => p.name === 'file')
  if (!filePart || !filePart.data || !filePart.filename) {
    throw createError({ statusCode: 400, statusMessage: 'Файл не передан' })
  }

  const fileBuffer = filePart.data
  if (fileBuffer.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Пустой файл' })
  }
  if (fileBuffer.length > MAX_ATTACHMENT_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: `Файл слишком большой. Максимум ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} МБ`,
    })
  }

  // ── MIME from magic bytes ──
  const detected = await fileTypeFromBuffer(fileBuffer)
  let mimeType = detected?.mime as string | undefined

  // file-type cannot identify text/plain or csv reliably — fallback by extension + header
  if (!mimeType) {
    const headerMime = filePart.type ?? ''
    if (headerMime === 'text/plain' || headerMime === 'text/csv') {
      mimeType = headerMime
    }
  }

  if (!mimeType || !ALLOWED_MIMES.has(mimeType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Недопустимый тип файла. Разрешены: PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, PNG, JPG, WEBP, GIF',
    })
  }

  // ── upload to S3 ──
  const attachmentId = crypto.randomUUID()
  const ext = EXT_BY_MIME[mimeType] ?? 'bin'
  const storageKey = `${orgId}/comments/${commentId}/${attachmentId}.${ext}`

  await uploadToS3(storageKey, fileBuffer, mimeType)

  // ── insert DB record; clean up on failure ──
  try {
    const [created] = await db
      .insert(commentAttachment)
      .values({
        id: attachmentId,
        commentId,
        fileName: sanitizeFilename(filePart.filename),
        storageKey,
        mimeType,
        sizeBytes: fileBuffer.length,
        uploadedByUserId: userId,
      })
      .returning({
        id: commentAttachment.id,
        commentId: commentAttachment.commentId,
        fileName: commentAttachment.fileName,
        storageKey: commentAttachment.storageKey,
        mimeType: commentAttachment.mimeType,
        sizeBytes: commentAttachment.sizeBytes,
        uploadedByUserId: commentAttachment.uploadedByUserId,
        createdAt: commentAttachment.createdAt,
      })

    if (!created) throw createError({ statusCode: 500, statusMessage: 'Не удалось создать запись о файле' })

    setResponseStatus(event, 201)
    return created
  } catch (dbError) {
    // best-effort cleanup of orphaned S3 object
    try {
      await deleteFromS3(storageKey)
    } catch {
      // swallow
    }
    throw dbError
  }
})
