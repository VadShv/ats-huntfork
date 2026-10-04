import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMapItem } from '../../../../../database/schema/app'

const paramsSchema = z.object({ id: z.string().min(1), itemId: z.string().min(1) })

/**
 * DELETE /api/jobs/[id]/search-map/items/[itemId] — удалить элемент.
 * Право: searchMap:edit
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId, itemId } = await getValidatedRouterParams(event, paramsSchema.parse)
  await requireJobInScope(event, jobId)

  const [existing] = await db.select({ id: jobSearchMapItem.id }).from(jobSearchMapItem)
    .where(and(eq(jobSearchMapItem.id, itemId), eq(jobSearchMapItem.organizationId, orgId))).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Элемент не найден' })

  await db.delete(jobSearchMapItem).where(and(eq(jobSearchMapItem.id, itemId), eq(jobSearchMapItem.organizationId, orgId)))

  return { success: true }
})
