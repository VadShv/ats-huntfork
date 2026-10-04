import { eq, asc } from 'drizzle-orm'
import {
  jobSearchMap, jobSearchMapSection, jobSearchMapItem, jobSearchMapDonor, jobSearchMapSegment,
} from '../../database/schema/app'

/**
 * Snapshot the current map state for versioning.
 * Returns a JSON-serializable snapshot.
 */
export async function snapshotMap(mapId: string) {
  const [map] = await db.select().from(jobSearchMap).where(eq(jobSearchMap.id, mapId)).limit(1)
  if (!map) throw new Error('Map not found')

  const sections = await db.select().from(jobSearchMapSection)
    .where(eq(jobSearchMapSection.mapId, mapId)).orderBy(asc(jobSearchMapSection.displayOrder))

  const items = await db.select().from(jobSearchMapItem)
    .where(eq(jobSearchMapItem.mapId, mapId)).orderBy(asc(jobSearchMapItem.displayOrder))

  const donors = await db.select().from(jobSearchMapDonor)
    .where(eq(jobSearchMapDonor.mapId, mapId)).orderBy(asc(jobSearchMapDonor.displayOrder))

  const segments = await db.select().from(jobSearchMapSegment)
    .where(eq(jobSearchMapSegment.mapId, mapId)).orderBy(asc(jobSearchMapSegment.displayOrder))

  return {
    summary: map.summary,
    sections: sections.map(s => ({
      title: s.title,
      guidance: s.guidance,
      displayOrder: s.displayOrder,
      items: items.filter(i => i.sectionId === s.id).map(i => ({
        value: i.value,
        note: i.note,
        origin: i.origin,
        displayOrder: i.displayOrder,
      })),
    })),
    donors: donors.map(d => ({
      donorCompanyId: d.donorCompanyId,
      layer: d.layer,
      priority: d.priority,
      rationale: d.rationale,
      hypothesisStatus: d.hypothesisStatus,
      displayOrder: d.displayOrder,
    })),
    segments: segments.map(s => ({
      name: s.name,
      donorLayer: s.donorLayer,
      titles: s.titles,
      geo: s.geo,
      channelId: s.channelId,
      queryString: s.queryString,
      queryUrl: s.queryUrl,
      priority: s.priority,
      hypothesisStatus: s.hypothesisStatus,
      displayOrder: s.displayOrder,
    })),
  }
}
