import { eq, asc, count } from 'drizzle-orm'
import {
  jobSearchMapSection, jobSearchMapItem, jobSearchMapDonor, jobSearchMapSegment,
  donorCompany, sourcingChannel, hhSavedSearch, jobSearchMapVersion,
} from '../../database/schema/app'

/**
 * Содержимое карты одним набором запросов — общий источник для GET /search-map,
 * экспорта (PDF/Markdown) и документ-вида. docs/tz-search-map-v2.md §3.2.
 *
 * Одна функция → экран и PDF не могут разойтись по данным.
 */
export async function loadMapBundle(mapId: string) {
  const [sections, items, donors, segments] = await Promise.all([
    db.select().from(jobSearchMapSection)
      .where(eq(jobSearchMapSection.mapId, mapId)).orderBy(asc(jobSearchMapSection.displayOrder)),
    db.select().from(jobSearchMapItem)
      .where(eq(jobSearchMapItem.mapId, mapId)).orderBy(asc(jobSearchMapItem.displayOrder)),
    db.select({
      donor: jobSearchMapDonor,
      company: { id: donorCompany.id, canonicalName: donorCompany.canonicalName, industry: donorCompany.industry, tags: donorCompany.tags },
    })
      .from(jobSearchMapDonor)
      .innerJoin(donorCompany, eq(donorCompany.id, jobSearchMapDonor.donorCompanyId))
      .where(eq(jobSearchMapDonor.mapId, mapId))
      .orderBy(asc(jobSearchMapDonor.displayOrder)),
    db.select({
      segment: jobSearchMapSegment,
      channel: {
        id: sourcingChannel.id, code: sourcingChannel.code, name: sourcingChannel.name,
        urlTemplate: sourcingChannel.urlTemplate, targetSite: sourcingChannel.targetSite,
        queryLanguageHint: sourcingChannel.queryLanguageHint,
      },
      hhSearchesCount: count(hhSavedSearch.id),
    })
      .from(jobSearchMapSegment)
      .leftJoin(sourcingChannel, eq(sourcingChannel.id, jobSearchMapSegment.channelId))
      .leftJoin(hhSavedSearch, eq(hhSavedSearch.searchMapSegmentId, jobSearchMapSegment.id))
      .where(eq(jobSearchMapSegment.mapId, mapId))
      .groupBy(
        jobSearchMapSegment.id, sourcingChannel.id, sourcingChannel.code, sourcingChannel.name,
        sourcingChannel.urlTemplate, sourcingChannel.targetSite, sourcingChannel.queryLanguageHint,
      )
      .orderBy(asc(jobSearchMapSegment.displayOrder)),
  ])

  return {
    sections: sections.map(s => ({ ...s, items: items.filter(i => i.sectionId === s.id) })),
    donors,
    segments,
  }
}

export async function loadMapVersions(mapId: string) {
  return db.select({
    id: jobSearchMapVersion.id,
    versionNo: jobSearchMapVersion.versionNo,
    label: jobSearchMapVersion.label,
    trigger: jobSearchMapVersion.trigger,
    comment: jobSearchMapVersion.comment,
    diffSummary: jobSearchMapVersion.diffSummary,
    createdAt: jobSearchMapVersion.createdAt,
  }).from(jobSearchMapVersion)
    .where(eq(jobSearchMapVersion.mapId, mapId))
    .orderBy(asc(jobSearchMapVersion.versionNo))
}
