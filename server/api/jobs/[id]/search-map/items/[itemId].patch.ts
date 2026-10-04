import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMapItem } from '../../../../../database/schema/app'

const paramsSchema = z.object({ id: z.string().min(1), itemId: z.string().min(1) })
const patchItemSchema = z.object({
  value: z.string().min(1).max(300).trim().optional(),
  note: z.string().max(1000).nullish(),
  displayOrder: z.number().int().min(0).optional(),
}).strict()

/**
 * PATCH /api/jobs/[id]/search-map/items/[itemId] — правка элемента.
 * Право: searchMap:edit. origin ai→manual при изменении value.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId, itemId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, patchItemSchema.parse)
  await requireJobInScope(event, jobId)

  const [existing] = await db.select().from(jobSearchMapItem)
    .where(and(eq(jobSearchMapItem.id, itemId), eq(jobSearchMapItem.organizationId, orgId))).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Элемент не найден' })

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.value !== undefined) {
    patch.value = body.value
    patch.normalizedValue = body.value.toLowerCase().trim().replace(/ё/g, 'е')
    if (existing.origin === 'ai') patch.origin = 'manual'
  }
  if (body.note !== undefined) patch.note = body.note
  if (body.displayOrder !== undefined) patch.displayOrder = body.displayOrder

  const [updated] = await db.update(jobSearchMapItem).set(patch)
    .where(and(eq(jobSearchMapItem.id, itemId), eq(jobSearchMapItem.organizationId, orgId)))
    .returning()

  return updated
})
