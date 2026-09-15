/**
 * Resolve the full hh.ru session for the current user:
 * config (DB/env) + account (OAuth tokens) + valid access token.
 *
 * This is the single entry point for any server util that needs to
 * make authenticated hh.ru API calls on behalf of a user.
 */
import type { HhConfig } from './config'
import { resolveHhConfig } from './config'
import { getHhAccountForUser, getValidAccessToken } from './tokens'
import { HhIntegrationError } from './errors'

export interface HhSession {
  accountId: string
  accessToken: string
  config: HhConfig
  organizationId: string
  userId: string
}

/**
 * Build an HhSession for the given org + user.
 * Throws HhIntegrationError if config is missing, account is not
 * connected, or token refresh fails.
 */
export async function getHhSession(
  orgId: string,
  userId: string,
): Promise<HhSession> {
  const config = await resolveHhConfig(orgId)
  if (!config) {
    throw new HhIntegrationError(
      'HH_NOT_CONFIGURED',
      'hh.ru не настроен для организации',
    )
  }

  const account = await getHhAccountForUser(orgId, userId)
  if (!account || !account.isActive) {
    throw new HhIntegrationError(
      'HH_NOT_CONNECTED',
      'Аккаунт hh.ru не подключён',
    )
  }

  let accessToken: string
  try {
    accessToken = await getValidAccessToken(account.id)
  }
  catch {
    throw new HhIntegrationError(
      'HH_TOKEN_EXPIRED',
      'Не удалось обновить токен hh.ru',
    )
  }

  return {
    accountId: account.id,
    accessToken,
    config,
    organizationId: orgId,
    userId,
  }
}
