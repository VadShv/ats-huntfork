import { and, eq } from 'drizzle-orm'
import { userInventory } from '../../database/schema'
import { SHOP_CATALOG } from '../../../shared/shop-catalog'
import { getBalance } from '../../utils/economy/wallet'

/** GET /api/shop — catalog with balance, owned & equipped state. */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id

  const [balance, inventory] = await Promise.all([
    getBalance(userId, orgId),
    db.query.userInventory.findMany({
      where: and(eq(userInventory.organizationId, orgId), eq(userInventory.userId, userId)),
    }),
  ])
  const owned = new Map(inventory.map(i => [i.itemKey, i]))

  return {
    balance,
    items: SHOP_CATALOG.map(i => ({
      key: i.key, type: i.type, name: i.name, description: i.description,
      cost: i.cost, value: i.value, icon: i.icon,
      owned: owned.has(i.key),
      equipped: owned.get(i.key)?.equipped ?? false,
    })),
  }
})
