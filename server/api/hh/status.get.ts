/**
 * GET /api/hh/status
 *
 * Returns the current user's hh.ru connection state. Used by the
 * "Settings → Integrations" page to render the Connect/Disconnect UI.
 */
import { getHhAccountForUser } from '../../utils/hh/tokens'
import { isHhConfigured } from '../../utils/hh/client'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  if (!isHhConfigured()) {
    return {
      configured: false,
      connected: false,
    }
  }

  const acc = await getHhAccountForUser(
    session.session.activeOrganizationId,
    session.user.id,
  )

  if (!acc) {
    return {
      configured: true,
      connected: false,
    }
  }

  return {
    configured: true,
    connected: acc.isActive,
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
