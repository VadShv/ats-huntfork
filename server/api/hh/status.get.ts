/**
 * GET /api/hh/status
 *
 * Returns the current user's hh.ru connection state. Used by the
 * "Settings → Integrations" page to render the Connect/Disconnect UI
 * and the OAuth-credentials form.
 */
import { getHhAccountForUser } from '../../utils/hh/tokens'
import { getHhConfigStatus, isHhConfiguredForOrg } from '../../utils/hh/config'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  const configStatus = await getHhConfigStatus(orgId)
  const configured = await isHhConfiguredForOrg(orgId)

  if (!configured) {
    return {
      configured: false,
      connected: false,
      configSource: configStatus.source,
      envAvailable: configStatus.envAvailable,
      dbAvailable: configStatus.dbAvailable,
    }
  }

  const acc = await getHhAccountForUser(orgId, session.user.id)

  if (!acc) {
    return {
      configured: true,
      connected: false,
      configSource: configStatus.source,
      envAvailable: configStatus.envAvailable,
      dbAvailable: configStatus.dbAvailable,
      clientIdMasked: configStatus.clientIdMasked,
      redirectUri: configStatus.redirectUri,
    }
  }

  return {
    configured: true,
    connected: acc.isActive,
    configSource: configStatus.source,
    envAvailable: configStatus.envAvailable,
    dbAvailable: configStatus.dbAvailable,
    clientIdMasked: configStatus.clientIdMasked,
    redirectUri: configStatus.redirectUri,
    account: {
      hhUserId: acc.hhUserId,
      hhEmployerId: acc.hhEmployerId,
      hhEmail: acc.hhEmail,
      hhFirstName: acc.hhFirstName,
      hhLastName: acc.hhLastName,
      connectedAt: acc.connectedAt,
      lastRefreshedAt: acc.lastRefreshedAt,
      accessTokenExpiresAt: acc.accessTokenExpiresAt,
      lastError: acc.lastError,
      webhookEnabled: Boolean(acc.webhookSubscriptionId && acc.webhookEnabledAt),
      webhookLastEventAt: acc.webhookLastEventAt,
    },
  }
})
