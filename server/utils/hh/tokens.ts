/**
 * Token storage layer for hh.ru integration.
 *
 * - Encrypts access/refresh tokens at rest using AES-256-GCM
 *   (key derived from BETTER_AUTH_SECRET via HKDF — see server/utils/encryption.ts).
 * - Provides a single entry point `getValidAccessToken()` that transparently
 *   refreshes the token if it's about to expire (or has expired) and returns
 *   a fresh value the caller can use immediately.
 */
import { and, eq } from 'drizzle-orm'
import { hhAccount } from '../../database/schema'
import { decrypt, encrypt } from '../encryption'
import { env } from '../env'
import type { HhTokenResponse } from './client'
import { refreshAccessToken } from './client'

/** Refresh the token if it expires within this many seconds. */
const REFRESH_SKEW_SECONDS = 60

interface SaveTokenArgs {
  organizationId: string
  userId: string
  hhUserId: string
  hhEmployerId?: string | null
  hhManagerId?: string | null
  hhEmail?: string | null
  hhFirstName?: string | null
  hhLastName?: string | null
  tokens: HhTokenResponse
}

/**
 * Persist a fresh OAuth token bundle for a user. Creates the row if it
 * doesn't exist, updates it in place otherwise (one hh account per user
 * per organization).
 */
export async function upsertHhAccount(args: SaveTokenArgs): Promise<string> {
  const secret = env.BETTER_AUTH_SECRET
  const accessEnc = encrypt(args.tokens.access_token, secret)
  const refreshEnc = encrypt(args.tokens.refresh_token, secret)
  const expiresAt = new Date(Date.now() + args.tokens.expires_in * 1000)

  const existing = await db
    .select({ id: hhAccount.id })
    .from(hhAccount)
    .where(and(
      eq(hhAccount.organizationId, args.organizationId),
      eq(hhAccount.userId, args.userId),
    ))
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(hhAccount)
      .set({
        hhUserId: args.hhUserId,
        hhEmployerId: args.hhEmployerId ?? null,
        hhManagerId: args.hhManagerId ?? null,
        hhEmail: args.hhEmail ?? null,
        hhFirstName: args.hhFirstName ?? null,
        hhLastName: args.hhLastName ?? null,
        accessTokenEncrypted: accessEnc,
        refreshTokenEncrypted: refreshEnc,
        accessTokenExpiresAt: expiresAt,
        scope: args.tokens.scope ?? null,
        isActive: true,
        lastError: null,
        lastRefreshedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(hhAccount.id, existing[0]!.id))
    return existing[0]!.id
  }

  const inserted = await db
    .insert(hhAccount)
    .values({
      organizationId: args.organizationId,
      userId: args.userId,
      hhUserId: args.hhUserId,
      hhEmployerId: args.hhEmployerId ?? null,
      hhManagerId: args.hhManagerId ?? null,
      hhEmail: args.hhEmail ?? null,
      hhFirstName: args.hhFirstName ?? null,
      hhLastName: args.hhLastName ?? null,
      accessTokenEncrypted: accessEnc,
      refreshTokenEncrypted: refreshEnc,
      accessTokenExpiresAt: expiresAt,
      scope: args.tokens.scope ?? null,
      isActive: true,
    })
    .returning({ id: hhAccount.id })
  return inserted[0]!.id
}

/**
 * Look up the current user's hh account. Returns null if none.
 */
export async function getHhAccountForUser(
  organizationId: string,
  userId: string,
): Promise<typeof hhAccount.$inferSelect | null> {
  const rows = await db
    .select()
    .from(hhAccount)
    .where(and(
      eq(hhAccount.organizationId, organizationId),
      eq(hhAccount.userId, userId),
    ))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Returns a usable access token for the given account, refreshing on demand.
 * Throws if refresh fails (e.g. revoked).
 */
export async function getValidAccessToken(
  accountId: string,
): Promise<string> {
  const rows = await db
    .select()
    .from(hhAccount)
    .where(eq(hhAccount.id, accountId))
    .limit(1)
  const acc = rows[0]
  if (!acc) throw new Error('hh account not found')
  if (!acc.isActive) throw new Error('hh account is disabled')

  const now = Date.now()
  const expiresAtMs = acc.accessTokenExpiresAt.getTime()
  if (expiresAtMs - now > REFRESH_SKEW_SECONDS * 1000) {
    // Still valid — return decrypted as-is.
    const decoded = decrypt(acc.accessTokenEncrypted, env.BETTER_AUTH_SECRET)
    if (!decoded) throw new Error('failed to decrypt hh access token')
    return decoded
  }

  // Need to refresh.
  const refreshPlain = decrypt(acc.refreshTokenEncrypted, env.BETTER_AUTH_SECRET)
  if (!refreshPlain) throw new Error('failed to decrypt hh refresh token')

  let fresh: HhTokenResponse
  try {
    fresh = await refreshAccessToken(refreshPlain)
  }
  catch (err) {
    await db
      .update(hhAccount)
      .set({
        lastError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(hhAccount.id, accountId))
    throw err
  }

  const newAccessEnc = encrypt(fresh.access_token, env.BETTER_AUTH_SECRET)
  const newRefreshEnc = encrypt(fresh.refresh_token, env.BETTER_AUTH_SECRET)
  const newExpires = new Date(Date.now() + fresh.expires_in * 1000)

  await db
    .update(hhAccount)
    .set({
      accessTokenEncrypted: newAccessEnc,
      refreshTokenEncrypted: newRefreshEnc,
      accessTokenExpiresAt: newExpires,
      scope: fresh.scope ?? acc.scope,
      lastRefreshedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(hhAccount.id, accountId))

  return fresh.access_token
}

/** Delete the hh account row entirely (used by /api/hh/disconnect). */
export async function disconnectHhAccount(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(hhAccount)
    .where(and(
      eq(hhAccount.organizationId, organizationId),
      eq(hhAccount.userId, userId),
    ))
    .returning({ id: hhAccount.id })
  return result.length > 0
}
