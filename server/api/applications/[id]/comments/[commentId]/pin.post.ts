import { and, eq } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../../utils/access/scope'
import { application, applicationComment } from '../../../../../database/schema/app'
import { notifyThreadChanged } from '../../../../../utils/comments/threadBus'

/**
 * POST /api/applications/:id/comments/:commentId/pin
 * Toggle pin state on a comment. Requires application: ['update'].
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const commentId = getRouterParam(event, 'commentId')!

  const existing = await db.query.applicationComment.findFirst({
    where: and(
      eq(applicationComment.id, commentId),
      eq(applicationComment.organizationId, orgId),
    ),
    columns: { id: true, isPinned: true, deletedAt: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Комментарий не найден' })
  if (existing.deletedAt) throw createError({ statusCode: 410, statusMessage: 'Комментарий удалён' })

  const newPinned = !existing.isPinned
  await db.update(applicationComment)
    .set({
      isPinned: newPinned,
      pinnedById: newPinned ? userId : null,
      pinnedAt: newPinned ? new Date() : null,
    })
    .where(eq(applicationComment.id, commentId))

  const appId = getRouterParam(event, 'id')!
  await requireApplicationInScope(event, appId as string, orgId as string)
  notifyThreadChanged(appId)

  return { id: commentId, isPinned: newPinned }
})
