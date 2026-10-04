import { eq, and, asc, count } from 'drizzle-orm'
import { z } from 'zod'
import {
  jobSearchMap, jobSearchMapSection, jobSearchMapItem, jobSearchMapDonor, jobSearchMapSegment,
  donorCompany, sourcingChannel, searchMapTemplate, searchMapTemplateSection,
  hhSavedSearch, jobBrief, scoringCriterion,
} from '../../../../database/schema/app'

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

  const sections = await db.select().from(jobSearchMapSection)
    .where(eq(jobSearchMapSection.mapId, map.id)).orderBy(asc(jobSearchMapSection.displayOrder))

  const items = await db.select().from(jobSearchMapItem)
    .where(eq(jobSearchMapItem.mapId, map.id)).orderBy(asc(jobSearchMapItem.displayOrder))

  const donors = await db.select({
    donor: jobSearchMapDonor,
    company: { id: donorCompany.id, canonicalName: donorCompany.canonicalName, industry: donorCompany.industry, tags: donorCompany.tags },
  })
    .from(jobSearchMapDonor)
    .innerJoin(donorCompany, eq(donorCompany.id, jobSearchMapDonor.donorCompanyId))
    .where(eq(jobSearchMapDonor.mapId, map.id))
    .orderBy(asc(jobSearchMapDonor.displayOrder))

  const segments = await db.select({
    segment: jobSearchMapSegment,
    channel: { id: sourcingChannel.id, code: sourcingChannel.code, name: sourcingChannel.name, urlTemplate: sourcingChannel.urlTemplate, targetSite: sourcingChannel.targetSite },
    hhSearchesCount: count(hhSavedSearch.id),
  })
    .from(jobSearchMapSegment)
    .leftJoin(sourcingChannel, eq(sourcingChannel.id, jobSearchMapSegment.channelId))
    .leftJoin(hhSavedSearch, eq(hhSavedSearch.searchMapSegmentId, jobSearchMapSegment.id))
    .where(eq(jobSearchMapSegment.mapId, map.id))
    .groupBy(jobSearchMapSegment.id)
    .orderBy(asc(jobSearchMapSegment.displayOrder))

  const currentHashes = await computeSourceHashes(jobId, orgId)
  const staleSources: string[] = []
  if (currentHashes.brief !== map.sourceHashes.brief) staleSources.push('brief')
  if (currentHashes.criteria !== map.sourceHashes.criteria) staleSources.push('criteria')
  if (currentHashes.description !== map.sourceHashes.description) staleSources.push('description')

  const [brief] = await db.select({ id: jobBrief.id }).from(jobBrief)
    .where(and(eq(jobBrief.jobId, jobId), eq(jobBrief.organizationId, orgId))).limit(1)
  const criteriaCount = await db.select({ n: count() }).from(scoringCriterion)
    .where(and(eq(scoringCriterion.jobId, jobId), eq(scoringCriterion.organizationId, orgId)))

  const versionsCount = await db.select({ n: count() }).from(jobSearchMap)
    .where(eq(jobSearchMap.id, map.id))

  return {
    map,
    sections: sections.map(s => ({
      ...s,
      items: items.filter(i => i.sectionId === s.id),
    })),
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
