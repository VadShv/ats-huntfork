import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import {
  application,
  applicationComment,
  commentAttachment,
} from '../../../../../../database/schema/app'

const paramsSchema = z.object({
  id: z.string().uuid('Неверный id отклика'),
  commentId: z.string().min(1),
  attachmentId: z.string().min(1),
})

/**
 * GET /api/applications/:id/comments/:commentId/attachments/:attachmentId
 *
 * Streams the file bytes through the server. Bucket stays private — no presigned URLs.
 * `?inline=1` switches to inline disposition (useful for images previewed in the UI);
 * default is `attachment` to force a download.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id, commentId, attachmentId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { inline } = await getValidatedQuery(
    event,
    z.object({ inline: z.coerce.boolean().optional() }).parse,
  )

  // verify ownership chain: application & comment must belong to the org
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  const comm = await db.query.applicationComment.findFirst({
    where: and(
      eq(applicationComment.id, commentId),
      eq(applicationComment.applicationId, id),
      eq(applicationComment.organizationId, orgId),
    ),
    columns: { id: true },
  })
  if (!comm) throw createError({ statusCode: 404, statusMessage: 'Комментарий не найден' })

  const att = await db.query.commentAttachment.findFirst({
    where: and(
      eq(commentAttachment.id, attachmentId),
      eq(commentAttachment.commentId, commentId),
    ),
    columns: {
      storageKey: true,
      fileName: true,
      mimeType: true,
    },
  })
  if (!att) throw createError({ statusCode: 404, statusMessage: 'Файл не найден' })

  const s3Response = await getS3Client().send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: att.storageKey }),
  )
  if (!s3Response.Body) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось получить файл' })
  }

  const encodedFilename = encodeURIComponent(att.fileName)
  const disposition = inline ? 'inline' : 'attachment'

  const headers: Record<string, string> = {
    'Content-Type': att.mimeType,
    'Content-Disposition': `${disposition}; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  }

  if (s3Response.ContentLength) {
    headers['Content-Length'] = String(s3Response.ContentLength)
  }

  setResponseHeaders(event, headers)

  return s3Response.Body.transformToWebStream()
})
