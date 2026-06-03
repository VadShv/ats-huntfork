/**
 * POST /api/hh/disconnect
 *
 * Removes the current user's hh.ru connection (tokens, links).
 * Existing imported applications/candidates are KEPT in Huntfork.
 */
import { disconnectHhAccount } from '../../utils/hh/tokens'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const removed = await disconnectHhAccount(
    session.session.activeOrganizationId,
    session.user.id,
  )

  return { ok: true, removed }
})
