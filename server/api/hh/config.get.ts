/**
 * GET /api/hh/config
 *
 * Returns the org-level hh.ru OAuth configuration status for the
 * integrations UI form. Never exposes the client secret. Used to
 * render the "Configure hh.ru credentials" form and show whether the
 * config comes from the DB (UI) or env vars.
 */
import { getHhConfigStatus } from '../../utils/hh/config'

export default defineEventHandler(async (event) => {
  await requirePermission(event, { organization: ['update'] })

  const session = await requireAuth(event)
  const status = await getHhConfigStatus(session.session.activeOrganizationId)

  return {
    source: status.source,
    envAvailable: status.envAvailable,
    dbAvailable: status.dbAvailable,
    clientIdMasked: status.clientIdMasked,
    redirectUri: status.redirectUri,
  }
})
