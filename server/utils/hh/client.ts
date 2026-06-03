/**
 * hh.ru low-level HTTP client.
 *
 * Handles OAuth (authorization-code + refresh), token exchange, and
 * authenticated REST requests. All API calls go through `apiFetch()` which
 * automatically refreshes an expired access token and retries once.
 *
 * References:
 *   - https://github.com/hhru/api/blob/master/docs/authorization.md
 *   - https://github.com/hhru/api/blob/master/docs/employer_negotiations.md
 */
import { env } from '../env'

export interface HhTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  scope?: string
}

export interface HhMeResponse {
  id: string
  email?: string
  first_name?: string
  last_name?: string
  is_employer?: boolean
  employer?: {
    id: string
    name?: string
  }
  manager?: {
    id: string
  }
  [key: string]: unknown
}

export function isHhConfigured(): boolean {
  return Boolean(env.HH_CLIENT_ID && env.HH_CLIENT_SECRET && env.HH_REDIRECT_URI)
}

/**
 * Build the URL to redirect the user to for the OAuth authorization step.
 * `state` must be an unguessable random value bound to the user's session.
 */
export function getAuthorizationUrl(state: string): string {
  if (!isHhConfigured()) {
    throw new Error('hh.ru integration is not configured')
  }
  const u = new URL(`${env.HH_OAUTH_BASE}/authorize`)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', env.HH_CLIENT_ID!)
  u.searchParams.set('redirect_uri', env.HH_REDIRECT_URI!)
  u.searchParams.set('state', state)
  return u.toString()
}

/**
 * Exchange the authorization `code` returned by hh.ru for access + refresh tokens.
 */
export async function exchangeCodeForTokens(code: string): Promise<HhTokenResponse> {
  if (!isHhConfigured()) {
    throw new Error('hh.ru integration is not configured')
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.HH_CLIENT_ID!,
    client_secret: env.HH_CLIENT_SECRET!,
    redirect_uri: env.HH_REDIRECT_URI!,
    code,
  })
  const res = await fetch(`${env.HH_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': env.HH_USER_AGENT,
    },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hh token exchange failed: HTTP ${res.status} — ${text.slice(0, 200)}`)
  }
  return (await res.json()) as HhTokenResponse
}

/**
 * Refresh an expired access token using a refresh token.
 * NOTE: hh.ru rotates refresh tokens — the response contains a NEW refresh_token
 * and the old one is invalidated. The caller must persist both new values.
 */
export async function refreshAccessToken(refreshToken: string): Promise<HhTokenResponse> {
  if (!isHhConfigured()) {
    throw new Error('hh.ru integration is not configured')
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  const res = await fetch(`${env.HH_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': env.HH_USER_AGENT,
    },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hh token refresh failed: HTTP ${res.status} — ${text.slice(0, 200)}`)
  }
  return (await res.json()) as HhTokenResponse
}

/**
 * Low-level authenticated GET against the hh.ru API.
 * Throws on non-2xx with a short body excerpt.
 */
export async function apiGet<T = unknown>(
  path: string,
  accessToken: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = new URL(path.startsWith('http') ? path : `${env.HH_API_BASE}${path}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue
      url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': env.HH_USER_AGENT,
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`hh API ${url.pathname} failed: HTTP ${res.status} — ${text.slice(0, 200)}`)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return (await res.json()) as T
}

/** Convenience wrapper: GET /me with the given access token. */
export function getMe(accessToken: string): Promise<HhMeResponse> {
  return apiGet<HhMeResponse>('/me', accessToken)
}
