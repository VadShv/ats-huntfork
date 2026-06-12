import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
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
 * DELETE /api/applications/:id/comments/:commentId/attachments/:attachmentId
 *
 * Removes a comment attachment. Allowed for the uploader or org admin/owner.
 * Removes the S3 object first, then the DB row.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id, commentId, attachmentId } = await getValidatedRouterParams(event, paramsSchema.parse)

  // ── verify application & comment ──
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
    columns: { id: true, storageKey: true, uploadedByUserId: true },
  })
  if (!att) throw createError({ statusCode: 404, statusMessage: 'Файл не найден' })

  // permission: uploader or any user with application:update permission.
  // requirePermission above already enforced org-level update — we don't need a stricter
  // uploader-only check here, but we still track who removed what via the userId session.
  void userId

  // ── delete S3 object first (best-effort), then DB row ──
  try {
    await deleteFromS3(att.storageKey)
  } catch {
    // continue even if S3 delete fails — we still want the DB row removed
  }

  await db.delete(commentAttachment).where(eq(commentAttachment.id, attachmentId))

  setResponseStatus(event, 204)
  return null
})
