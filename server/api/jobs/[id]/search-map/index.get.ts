import { eq, and, count } from 'drizzle-orm'
import { z } from 'zod'
import {
  job, jobSearchMap, searchMapTemplate, jobBrief, scoringCriterion, jobSearchMapVersion,
} from '../../../../database/schema/app'
import { loadMapBundle } from '../../../../utils/searchMap/loadMapBundle'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * GET /api/jobs/[id]/search-map — вся карта одним ответом.
 * Право: searchMap:view. 404 {reason:'not_created', templates} если карты нет.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  await requireJobInScope(event, jobId)

  const [map] = await db.select().from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)

  if (!map) {
    const templates = await db.select({ id: searchMapTemplate.id, name: searchMapTemplate.name, isDefault: searchMapTemplate.isDefault })
      .from(searchMapTemplate)
      .where(and(eq(searchMapTemplate.organizationId, orgId), eq(searchMapTemplate.status, 'published')))
    throw createError({ statusCode: 404, statusMessage: 'Карта поиска не создана', data: { reason: 'not_created', templates } })
  }

  const [{ sections, donors, segments }, [jobRow]] = await Promise.all([
    loadMapBundle(map.id),
    db.select({ title: job.title }).from(job).where(eq(job.id, jobId)).limit(1),
  ])

  const currentHashes = await computeSourceHashes(jobId, orgId)
  const staleSources: string[] = []
  if (currentHashes.brief !== map.sourceHashes.brief) staleSources.push('brief')
  if (currentHashes.criteria !== map.sourceHashes.criteria) staleSources.push('criteria')
  if (currentHashes.description !== map.sourceHashes.description) staleSources.push('description')

  const [brief] = await db.select({ id: jobBrief.id }).from(jobBrief)
    .where(and(eq(jobBrief.jobId, jobId), eq(jobBrief.organizationId, orgId))).limit(1)
  const criteriaCount = await db.select({ n: count() }).from(scoringCriterion)
    .where(and(eq(scoringCriterion.jobId, jobId), eq(scoringCriterion.organizationId, orgId)))

  // Считаем именно версии (раньше считались строки jobSearchMap — всегда 1).
  const versionsCount = await db.select({ n: count() }).from(jobSearchMapVersion)
    .where(eq(jobSearchMapVersion.mapId, map.id))

  return {
    jobTitle: jobRow?.title ?? '',
    map,
    sections,
    donors,
    segments,
    isStale: staleSources.length > 0,
    staleSources,
    canGenerate: {
      hasBrief: !!brief,
      hasCriteria: (criteriaCount[0]?.n ?? 0) > 0,
      hasDescription: true,
      hasAiConfig: true,
    },
    versionsCount: map.currentVersionNo,
  }
})
