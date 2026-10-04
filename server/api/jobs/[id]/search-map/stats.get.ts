import { eq, and, count } from 'drizzle-orm'
import { z } from 'zod'
import {
  jobSearchMap, jobSearchMapSegment, jobSearchMapDonor, hhSavedSearch, hhSourcingCandidate,
} from '../../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * GET /api/jobs/[id]/search-map/stats — статистика по сегментам и донорам.
 * Право: searchMap:view
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  await requireJobInScope(event, jobId)

  const [map] = await db.select({ id: jobSearchMap.id }).from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  const segments = await db.select({
    id: jobSearchMapSegment.id,
    hypothesisStatus: jobSearchMapSegment.hypothesisStatus,
    isArchived: jobSearchMapSegment.isArchived,
  }).from(jobSearchMapSegment).where(eq(jobSearchMapSegment.mapId, map.id))

  const segmentsByStatus = segments.reduce((acc, s) => {
    if (!s.isArchived) acc[s.hypothesisStatus] = (acc[s.hypothesisStatus] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const donors = await db.select({
    layer: jobSearchMapDonor.layer,
    hypothesisStatus: jobSearchMapDonor.hypothesisStatus,
  }).from(jobSearchMapDonor).where(eq(jobSearchMapDonor.mapId, map.id))

  const donorsByLayer = donors.reduce((acc, d) => {
    acc[d.layer] = (acc[d.layer] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const donorsByStatus = donors.reduce((acc, d) => {
    acc[d.hypothesisStatus] = (acc[d.hypothesisStatus] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const hhSearches = await db.select({
    segmentId: hhSavedSearch.searchMapSegmentId,
    lastRunAt: hhSavedSearch.lastRunAt,
  }).from(hhSavedSearch)
    .where(and(eq(hhSavedSearch.jobId, jobId), eq(hhSavedSearch.organizationId, orgId)))

  return {
    segmentsTotal: segments.filter(s => !s.isArchived).length,
    segmentsByStatus,
    donorsByLayer,
    donorsByStatus,
    hhSearchesCount: hhSearches.length,
    lastRunAt: hhSearches.reduce((max, h) => h.lastRunAt && (!max || h.lastRunAt > max) ? h.lastRunAt : max, null as Date | null),
  }
})
