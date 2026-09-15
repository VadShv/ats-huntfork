/**
 * GET /api/hh/connect
 *
 * Starts the hh.ru OAuth2 authorization-code flow. Generates a CSRF state
 * token, stores it in a short-lived httpOnly cookie, and redirects the
 * recruiter to hh.ru's consent screen.
 */
import { randomBytes } from 'node:crypto'
import { getAuthorizationUrl } from '../../utils/hh/client'
import { isHhConfiguredForOrg, resolveHhConfig } from '../../utils/hh/config'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })

  const orgId = session.session.activeOrganizationId
  if (!(await isHhConfiguredForOrg(orgId))) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Интеграция с hh.ru не настроена',
    })
  }

  const config = await resolveHhConfig(orgId)
  const stateToken = randomBytes(32).toString('hex')
  setCookie(event, 'hh_oauth_state', stateToken, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: 300,
    path: '/api/hh/callback',
  })

  return sendRedirect(event, getAuthorizationUrl(stateToken, config))
})
