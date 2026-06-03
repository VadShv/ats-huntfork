/**
 * GET /api/hh/callback
 *
 * Handles the OAuth2 callback from hh.ru. Validates the CSRF state cookie,
 * exchanges the authorization `code` for tokens, fetches the user's profile
 * via /me, and persists everything encrypted in `hh_account`.
 */
import { timingSafeEqual } from 'node:crypto'
import { exchangeCodeForTokens, getMe } from '../../utils/hh/client'
import { upsertHhAccount } from '../../utils/hh/tokens'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const query = getQuery(event)
  const code = query.code as string | undefined
  const state = query.state as string | undefined
  const errorParam = query.error as string | undefined

  if (errorParam) {
    return sendRedirect(event, '/dashboard/settings/integrations?hh_error=consent_denied')
  }

  if (!code || !state) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing authorization code or state',
    })
  }

  // Validate CSRF state token from cookie
  const storedState = getCookie(event, 'hh_oauth_state')
  deleteCookie(event, 'hh_oauth_state', { path: '/api/hh/callback' })

  if (!storedState || storedState.length !== state.length) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Invalid OAuth state — possible CSRF attack',
    })
  }
  const match = timingSafeEqual(
    Buffer.from(storedState, 'utf-8'),
    Buffer.from(state, 'utf-8'),
  )
  if (!match) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Invalid OAuth state — possible CSRF attack',
    })
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    const me = await getMe(tokens.access_token)

    await upsertHhAccount({
      organizationId: session.session.activeOrganizationId,
      userId: session.user.id,
      hhUserId: me.id,
      hhEmployerId: me.employer?.id ?? null,
      hhManagerId: me.manager?.id ?? null,
      hhEmail: me.email ?? null,
      hhFirstName: me.first_name ?? null,
      hhLastName: me.last_name ?? null,
      tokens,
    })

    return sendRedirect(event, '/dashboard/settings/integrations?hh_success=connected')
  }
  catch (err) {
    console.error('[hh.callback]', err)
    return sendRedirect(event, '/dashboard/settings/integrations?hh_error=oauth_failed')
  }
})
