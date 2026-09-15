/**
 * DELETE /api/hh/config
 *
 * Remove the org-level hh.ru OAuth credentials (entered via UI).
 * Falls back to env vars if they are set. Use this to switch back to
 * env-based configuration or to fully reset the hh.ru integration.
 */
import { deleteHhConfig } from '../../utils/hh/config'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })

  const removed = await deleteHhConfig(session.session.activeOrganizationId)

  return { ok: true, removed }
})
