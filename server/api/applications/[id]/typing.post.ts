import { setTyping } from '../../../utils/comments/typing-store'

/**
 * POST /api/applications/:id/typing
 * Set typing indicator for current user (3s TTL).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const userId = session.user.id
  const id = getRouterParam(event, 'id')!

  setTyping(id, userId, session.user.name ?? session.user.email ?? '?')
  return { ok: true }
})
