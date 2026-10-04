import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMap, hhSavedSearch } from '../../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * DELETE /api/jobs/[id]/search-map — удалить карту с версиями.
 * Право: searchMap:edit. hh_saved_search.search_map_segment_id → set null.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  await requireJobInScope(event, jobId)

  const [map] = await db.select({ id: jobSearchMap.id }).from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  const detached = await db.update(hhSavedSearch).set({ searchMapSegmentId: null })
    .where(eq(hhSavedSearch.jobId, jobId))

  await db.delete(jobSearchMap).where(eq(jobSearchMap.id, map.id))

  return { success: true, detachedHhSearches: detached?.count ?? 0 }
})
