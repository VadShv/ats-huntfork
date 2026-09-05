import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { userInventory } from '../../database/schema'
import { shopItem } from '../../../shared/shop-catalog'
import { debitCoins, getBalance } from '../../utils/economy/wallet'

const bodySchema = z.object({ key: z.string().min(1) })

/** POST /api/shop/purchase — buy a cosmetic (deduct coins, add to inventory). */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id
  const { key } = await readValidatedBody(event, bodySchema.parse)

  const item = shopItem(key)
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Товар не найден' })

  const existing = await db.query.userInventory.findFirst({
    where: and(eq(userInventory.organizationId, orgId), eq(userInventory.userId, userId), eq(userInventory.itemKey, key)),
  })
  if (existing) throw createError({ statusCode: 409, statusMessage: 'Товар уже куплен' })

  await debitCoins(userId, orgId, item.cost, 'purchase', key)
  await db.insert(userInventory).values({
    userId, organizationId: orgId, itemKey: key, itemType: item.type,
  }).onConflictDoNothing()

  const balance = await getBalance(userId, orgId)
  return { success: true, balance }
})
