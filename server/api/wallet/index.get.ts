import { and, eq } from 'drizzle-orm'
import { coinTransaction } from '../../database/schema'
import { getBalance } from '../../utils/economy/wallet'

const REASON_LABELS: Record<string, string> = {
  quest: 'Квест', duel: 'Дуэль', tier: 'Тир HuntPass', purchase: 'Покупка',
}

/** GET /api/wallet — coin balance + recent transactions. */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id

  const [balance, txns] = await Promise.all([
    getBalance(userId, orgId),
    db.query.coinTransaction.findMany({
      where: and(eq(coinTransaction.organizationId, orgId), eq(coinTransaction.userId, userId)),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 20,
    }),
  ])

  return {
    balance,
    transactions: txns.map(t => ({
      amount: t.amount,
      reason: t.reason,
      reasonLabel: REASON_LABELS[t.reason] ?? t.reason,
      createdAt: t.createdAt,
    })),
  }
})
