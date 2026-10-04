import { eq, and, count } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMapSegment, hhSavedSearch } from '../../../../../database/schema/app'

const paramsSchema = z.object({ id: z.string().min(1), segmentId: z.string().min(1) })

/**
 * DELETE /api/jobs/[id]/search-map/segments/[segmentId] — удалить сегмент.
 * Право: searchMap:edit. 409 если есть привязанные hh-поиски.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId, segmentId } = await getValidatedRouterParams(event, paramsSchema.parse)
  await requireJobInScope(event, jobId)

  const [existing] = await db.select().from(jobSearchMapSegment)
    .where(and(eq(jobSearchMapSegment.id, segmentId), eq(jobSearchMapSegment.organizationId, orgId))).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Сегмент не найден' })

  const [hhCount] = await db.select({ n: count() }).from(hhSavedSearch)
    .where(eq(hhSavedSearch.searchMapSegmentId, segmentId))
  if (hhCount && hhCount.n > 0) {
    throw createError({ statusCode: 409, statusMessage: `Сегмент имеет ${hhCount.n} привязанных hh-поисков; архивируйте сегмент вместо удаления`, data: { hhSearches: hhCount.n } })
  }

  await db.delete(jobSearchMapSegment).where(and(eq(jobSearchMapSegment.id, segmentId), eq(jobSearchMapSegment.organizationId, orgId)))

  return { success: true }
})
