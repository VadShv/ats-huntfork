/**
 * MyMeet connection storage (Этап 5) — API-ключ на уровне организации.
 * Шифруется AES-256-GCM (как hh/ai_config), клиенту никогда не возвращается.
 */
import { eq } from 'drizzle-orm'
import { mymeetAccount } from '../../database/schema'
import { decrypt, encrypt } from '../encryption'
import { env } from '../env'

export async function upsertMymeetAccount(orgId: string, apiKey: string, connectedById: string): Promise<void> {
  const apiKeyEncrypted = encrypt(apiKey, env.BETTER_AUTH_SECRET)
  const now = new Date()
  await db.insert(mymeetAccount)
    .values({ organizationId: orgId, apiKeyEncrypted, connectedById })
    .onConflictDoUpdate({
      target: mymeetAccount.organizationId,
      set: { apiKeyEncrypted, connectedById, updatedAt: now },
    })
}

/** Расшифрованный API-ключ (JIT) или null, если не подключено. */
export async function getMymeetApiKey(orgId: string): Promise<string | null> {
  const row = await db.query.mymeetAccount.findFirst({
    where: eq(mymeetAccount.organizationId, orgId),
    columns: { apiKeyEncrypted: true },
  })
  if (!row) return null
  return decrypt(row.apiKeyEncrypted, env.BETTER_AUTH_SECRET)
}

export async function isMymeetConnected(orgId: string): Promise<boolean> {
  const row = await db.query.mymeetAccount.findFirst({
    where: eq(mymeetAccount.organizationId, orgId),
    columns: { id: true },
  })
  return Boolean(row)
}

export async function disconnectMymeet(orgId: string): Promise<void> {
  await db.delete(mymeetAccount).where(eq(mymeetAccount.organizationId, orgId))
}
