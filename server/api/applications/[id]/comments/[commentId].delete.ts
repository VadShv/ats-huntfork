import { and, eq } from 'drizzle-orm'
import { application, applicationComment } from '../../../../database/schema/app'
import { member } from '../../../../database/schema/auth'
import { applicationCommentIdParamSchema } from '../../../../utils/schemas/applicationComment'

/**
 * DELETE /api/applications/:id/comments/:commentId
 *
 * Soft delete: sets `deleted_at = now()` so audit trail is preserved.
 * Authors can delete own; owner/admin can delete any.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id, commentId } = await getValidatedRouterParams(
    event,
    applicationCommentIdParamSchema.parse,
  )

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
  if (existing.deletedAt) {
    setResponseStatus(event, 204)
    return null
  }

  // ownership / admin check
  if (existing.authorUserId !== userId) {
    const mem = await db.query.member.findFirst({
      where: and(eq(member.userId, userId), eq(member.organizationId, orgId)),
      columns: { role: true },
    })
    const isAdminOrOwner = mem?.role === 'admin' || mem?.role === 'owner'
    if (!isAdminOrOwner) {
      throw createError({ statusCode: 403, statusMessage: 'Можно удалять только свои комментарии' })
    }
  }

  const now = new Date()
  await db
    .update(applicationComment)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(applicationComment.id, commentId))

  void recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'deleted',
    resourceType: 'application_comment',
    resourceId: commentId,
    metadata: { applicationId: id },
  })

  setResponseStatus(event, 204)
  return null
})
