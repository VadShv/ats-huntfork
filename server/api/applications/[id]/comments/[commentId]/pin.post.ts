import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireApplicationInScope } from '../../../../../utils/access/scope'
import { applicationComment, commentPinPersonal } from '../../../../../database/schema/app'
import { notifyThreadChanged } from '../../../../../utils/comments/threadBus'

const bodySchema = z.object({
  /** 'all' — закрепить для всех (is_pinned), 'me' — только для себя (comment_pin_personal). */
  scope: z.enum(['all', 'me']).default('all'),
}).default({ scope: 'all' })

/**
 * POST /api/applications/:id/comments/:commentId/pin
 * Переключить закрепление сообщения.
 *   scope='all' — для всех участников (application: ['update']).
 *   scope='me'  — личное, видно только автору действия (application: ['read']).
 * Ответ: { id, scope, isPinned | isPinnedByMe }.
 */
export default defineEventHandler(async (event) => {
  const body = bodySchema.parse((await readBody(event).catch(() => null)) ?? {})
  const session = body.scope === 'me'
    ? await requirePermission(event, { application: ['read'] })
    : await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const commentId = getRouterParam(event, 'commentId')!
  const appId = getRouterParam(event, 'id')!
  await requireApplicationInScope(event, appId as string, orgId as string)

  const existing = await db.query.applicationComment.findFirst({
    where: and(
      eq(applicationComment.id, commentId),
      eq(applicationComment.organizationId, orgId),
      eq(applicationComment.applicationId, appId),
    ),
    columns: { id: true, isPinned: true, deletedAt: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Комментарий не найден' })
  if (existing.deletedAt) throw createError({ statusCode: 410, statusMessage: 'Комментарий удалён' })

  if (body.scope === 'me') {
    const mine = await db.query.commentPinPersonal.findFirst({
      where: and(eq(commentPinPersonal.commentId, commentId), eq(commentPinPersonal.userId, userId)),
      columns: { id: true },
    })
    if (mine) {
      await db.delete(commentPinPersonal).where(eq(commentPinPersonal.id, mine.id))
      return { id: commentId, scope: 'me' as const, isPinnedByMe: false }
    }
    await db.insert(commentPinPersonal)
      .values({ organizationId: orgId, applicationId: appId, commentId, userId })
      .onConflictDoNothing()
    // Личное закрепление других участников не касается — поток треда не дёргаем.
    return { id: commentId, scope: 'me' as const, isPinnedByMe: true }
  }

  const newPinned = !existing.isPinned
  await db.update(applicationComment)
    .set({
      isPinned: newPinned,
      pinnedById: newPinned ? userId : null,
      pinnedAt: newPinned ? new Date() : null,
    })
    .where(eq(applicationComment.id, commentId))

  notifyThreadChanged(appId)
  return { id: commentId, scope: 'all' as const, isPinned: newPinned }
})
