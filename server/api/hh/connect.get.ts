/**
 * GET /api/hh/connect
 *
 * Starts the hh.ru OAuth2 authorization-code flow. Generates a CSRF state
 * token, stores it in a short-lived httpOnly cookie, and redirects the
 * recruiter to hh.ru's consent screen.
 */
import { randomBytes } from 'node:crypto'
import { getAuthorizationUrl, isHhConfigured } from '../../utils/hh/client'

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  if (!isHhConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'hh.ru integration is not configured',
    })
  }

  const stateToken = randomBytes(32).toString('hex')
  setCookie(event, 'hh_oauth_state', stateToken, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: 300,
    path: '/api/hh/callback',
  })

  return sendRedirect(event, getAuthorizationUrl(stateToken))
})
