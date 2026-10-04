import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMap, jobSearchMapSection, jobSearchMapItem } from '../../../../../../database/schema/app'
import { normalizeCompanyName } from '../../../../../../utils/searchMap/normalizeCompanyName'

const paramsSchema = z.object({ id: z.string().min(1), sectionId: z.string().min(1) })
const addItemsSchema = z.object({
  items: z.array(z.object({
    value: z.string().min(1).max(300).trim(),
    note: z.string().max(1000).nullish(),
    origin: z.enum(['manual', 'ai', 'template']).optional().default('manual'),
  })).min(1).max(100),
})

/**
 * POST /api/jobs/[id]/search-map/sections/[sectionId]/items — bulk-добавление элементов.
 * Право: searchMap:edit. Дубли по normalizedValue молча пропускаются.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId, sectionId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, addItemsSchema.parse)
  await requireJobInScope(event, jobId)

  const [section] = await db.select({ id: jobSearchMapSection.id, mapId: jobSearchMapSection.mapId })
    .from(jobSearchMapSection)
    .where(and(eq(jobSearchMapSection.id, sectionId), eq(jobSearchMapSection.organizationId, orgId))).limit(1)
  if (!section) throw createError({ statusCode: 404, statusMessage: 'Секция не найдена' })

  const existing = await db.select({ normalizedValue: jobSearchMapItem.normalizedValue }).from(jobSearchMapItem)
    .where(eq(jobSearchMapItem.sectionId, sectionId))

  const existingSet = new Set(existing.map(e => e.normalizedValue))
  let added = 0
  let skipped = 0

  for (const item of body.items) {
    const normalizedValue = item.value.toLowerCase().trim().replace(/ё/g, 'е')
    if (existingSet.has(normalizedValue)) { skipped++; continue }
    existingSet.add(normalizedValue)

    await db.insert(jobSearchMapItem).values({
      organizationId: orgId,
      mapId: section.mapId,
      sectionId,
      value: item.value,
      normalizedValue,
      note: item.note ?? null,
      origin: item.origin,
      displayOrder: added,
    })
    added++
  }

  return { added, skipped }
})
