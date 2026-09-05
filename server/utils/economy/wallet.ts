/**
 * Coin wallet — credit / debit with an append-only transaction log.
 */
import { and, eq, sql } from 'drizzle-orm'
import { userWallet, coinTransaction } from '../../database/schema'

export async function getBalance(userId: string, orgId: string): Promise<number> {
  const w = await db.query.userWallet.findFirst({
    where: and(eq(userWallet.organizationId, orgId), eq(userWallet.userId, userId)),
  })
  return w?.balance ?? 0
}

/** Add coins (earn). Idempotent-friendly via refId in the transaction log. */
export async function creditCoins(userId: string, orgId: string, amount: number, reason: string, refId?: string): Promise<void> {
  if (amount <= 0) return
  await db.insert(userWallet)
    .values({ userId, organizationId: orgId, balance: amount })
    .onConflictDoUpdate({
      target: [userWallet.organizationId, userWallet.userId],
      set: { balance: sql`${userWallet.balance} + ${amount}`, updatedAt: new Date() },
    })
  await db.insert(coinTransaction).values({ userId, organizationId: orgId, amount, reason, refId: refId ?? null })
}

/** Spend coins. Throws if insufficient balance. */
export async function debitCoins(userId: string, orgId: string, amount: number, reason: string, refId?: string): Promise<void> {
  if (amount <= 0) return
  const balance = await getBalance(userId, orgId)
  if (balance < amount) {
    throw createError({ statusCode: 400, statusMessage: 'Недостаточно монет' })
  }
  await db.update(userWallet)
    .set({ balance: sql`${userWallet.balance} - ${amount}`, updatedAt: new Date() })
    .where(and(eq(userWallet.organizationId, orgId), eq(userWallet.userId, userId)))
  await db.insert(coinTransaction).values({ userId, organizationId: orgId, amount: -amount, reason, refId: refId ?? null })
}
