/**
 * Org-level hh.ru OAuth configuration resolver.
 *
 * Resolution order (highest → lowest priority):
 *   1. DB row `hh_oauth_config` for the organization (entered via UI)
 *   2. Env vars HH_CLIENT_ID / HH_CLIENT_SECRET / HH_REDIRECT_URI (+ overrides)
 *
 * This lets an admin configure hh.ru entirely from the UI without server
 * access, while self-hosters can still use env vars as a fallback.
 */
import { eq } from 'drizzle-orm'
import { hhOauthConfig } from '../../database/schema'
import { decrypt, encrypt } from '../encryption'
import { env } from '../env'

/** Effective hh.ru configuration used by the OAuth client and API calls. */
export interface HhConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  oauthBase: string
  apiBase: string
  userAgent: string
}

/** Where the effective configuration came from — surfaced in the UI. */
export type HhConfigSource = 'db' | 'env' | 'none'

/**
 * Build an HhConfig from env vars, or null if the required credentials
 * are not set.
 */
function configFromEnv(): HhConfig | null {
  if (!env.HH_CLIENT_ID || !env.HH_CLIENT_SECRET || !env.HH_REDIRECT_URI) {
    return null
  }
  return {
    clientId: env.HH_CLIENT_ID,
    clientSecret: env.HH_CLIENT_SECRET,
    redirectUri: env.HH_REDIRECT_URI,
    oauthBase: env.HH_OAUTH_BASE,
    apiBase: env.HH_API_BASE,
    userAgent: env.HH_USER_AGENT,
  }
}

/**
 * Read the org-level DB config row and decrypt the client secret.
 * Returns null if no row exists or decryption fails.
 */
async function configFromDb(organizationId: string): Promise<HhConfig | null> {
  const rows = await db
    .select()
    .from(hhOauthConfig)
    .where(eq(hhOauthConfig.organizationId, organizationId))
    .limit(1)
  const row = rows[0]
  if (!row) return null

  const clientSecret = decrypt(row.clientSecretEncrypted, env.BETTER_AUTH_SECRET)
  if (!clientSecret) return null

  return {
    clientId: row.clientId,
    clientSecret,
    redirectUri: row.redirectUri,
    oauthBase: row.oauthBase ?? env.HH_OAUTH_BASE,
    apiBase: row.apiBase ?? env.HH_API_BASE,
    userAgent: row.userAgent ?? env.HH_USER_AGENT,
  }
}

/**
 * Resolve the effective hh.ru config for an organization.
 * DB (UI-entered) takes precedence over env. Returns null if neither is set.
 */
export async function resolveHhConfig(organizationId: string): Promise<HhConfig | null> {
  const fromDb = await configFromDb(organizationId)
  if (fromDb) return fromDb
  return configFromEnv()
}

/** Whether hh.ru is usable for this organization (DB or env). */
export async function isHhConfiguredForOrg(organizationId: string): Promise<boolean> {
  const cfg = await resolveHhConfig(organizationId)
  return cfg !== null
}

/**
 * Status for the integrations UI: which source is active and whether the
 * redirect URI is set (needed for webhook URL derivation). Never exposes
 * the client secret.
 */
export interface HhConfigStatus {
  source: HhConfigSource
  /** True when env vars HH_CLIENT_ID/SECRET/REDIRECT_URI are all set. */
  envAvailable: boolean
  /** True when a DB row exists for this org. */
  dbAvailable: boolean
  /** Masked client id for display (last 4 chars). */
  clientIdMasked: string | null
  redirectUri: string | null
}

export async function getHhConfigStatus(organizationId: string): Promise<HhConfigStatus> {
  const envCfg = configFromEnv()
  const dbRows = await db
    .select({ clientId: hhOauthConfig.clientId, redirectUri: hhOauthConfig.redirectUri })
    .from(hhOauthConfig)
    .where(eq(hhOauthConfig.organizationId, organizationId))
    .limit(1)
  const dbRow = dbRows[0] ?? null

  const source: HhConfigSource = dbRow ? 'db' : envCfg ? 'env' : 'none'
  const activeId = dbRow?.clientId ?? envCfg?.clientId ?? null
  const activeRedirect = dbRow?.redirectUri ?? envCfg?.redirectUri ?? null

  return {
    source,
    envAvailable: envCfg !== null,
    dbAvailable: dbRow !== null,
    clientIdMasked: activeId ? maskClientId(activeId) : null,
    redirectUri: activeRedirect,
  }
}

function maskClientId(id: string): string {
  if (id.length <= 4) return '••••'
  return `••••${id.slice(-4)}`
}

// ── Persistence (used by /api/hh/config PUT) ──────────────────────────────

export interface SaveHhConfigInput {
  clientId: string
  clientSecret: string
  redirectUri: string
  oauthBase?: string | null
  apiBase?: string | null
  userAgent?: string | null
}

/**
 * Upsert the org-level hh.ru OAuth config. Encrypts the client secret.
 * Returns the masked client id for display.
 */
export async function saveHhConfig(
  organizationId: string,
  input: SaveHhConfigInput,
): Promise<{ clientIdMasked: string }> {
  const secretEnc = encrypt(input.clientSecret, env.BETTER_AUTH_SECRET)
  const now = new Date()

  const existing = await db
    .select({ id: hhOauthConfig.id })
    .from(hhOauthConfig)
    .where(eq(hhOauthConfig.organizationId, organizationId))
    .limit(1)

  const values = {
    clientId: input.clientId,
    clientSecretEncrypted: secretEnc,
    redirectUri: input.redirectUri,
    oauthBase: input.oauthBase?.trim() || null,
    apiBase: input.apiBase?.trim() || null,
    userAgent: input.userAgent?.trim() || null,
    updatedAt: now,
  }

  if (existing.length > 0) {
    await db
      .update(hhOauthConfig)
      .set(values)
      .where(eq(hhOauthConfig.id, existing[0]!.id))
  }
  else {
    await db
      .insert(hhOauthConfig)
      .values({
        organizationId,
        ...values,
      })
  }

  return { clientIdMasked: maskClientId(input.clientId) }
}

/** Delete the org-level hh.ru OAuth config (UI "clear credentials"). */
export async function deleteHhConfig(organizationId: string): Promise<boolean> {
  const result = await db
    .delete(hhOauthConfig)
    .where(eq(hhOauthConfig.organizationId, organizationId))
    .returning({ id: hhOauthConfig.id })
  return result.length > 0
}
