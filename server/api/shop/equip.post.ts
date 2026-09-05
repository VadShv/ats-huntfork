import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { userInventory } from '../../database/schema'
import { shopItem } from '../../../shared/shop-catalog'

const bodySchema = z.object({ key: z.string().min(1), equip: z.boolean().default(true) })

/** POST /api/shop/equip — equip/unequip a cosmetic (one active per type slot). */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id
  const { key, equip } = await readValidatedBody(event, bodySchema.parse)

  const item = shopItem(key)
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Товар не найден' })

  const owned = await db.query.userInventory.findFirst({
    where: and(eq(userInventory.organizationId, orgId), eq(userInventory.userId, userId), eq(userInventory.itemKey, key)),
  })
  if (!owned) throw createError({ statusCode: 400, statusMessage: 'Товар не куплен' })

  if (equip) {
    // Unequip other items of the same type, then equip this one.
    await db.update(userInventory)
      .set({ equipped: false })
      .where(and(eq(userInventory.organizationId, orgId), eq(userInventory.userId, userId), eq(userInventory.itemType, item.type), ne(userInventory.itemKey, key)))
  }
  await db.update(userInventory).set({ equipped: equip }).where(eq(userInventory.id, owned.id))

  return { success: true, equipped: equip }
})
