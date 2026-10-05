import { eq, and, asc } from 'drizzle-orm'
import { z } from 'zod'
import {
  job, jobSearchMap, jobSearchMapSection, jobSearchMapItem, jobSearchMapDonor, jobSearchMapSegment,
  donorCompany, sourcingChannel,
} from '../../../../database/schema/app'
import { exportMarkdown } from '../../../../utils/searchMap/exportMarkdown'
import { exportHtml } from '../../../../utils/searchMap/exportPdf'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * GET /api/jobs/[id]/search-map/export?format=md|pdf — экспорт карты.
 * Право: searchMap:view
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  await requireJobInScope(event, jobId)
  const format = getQuery(event).format === 'pdf' ? 'pdf' : 'md'

  const [j] = await db.select({ title: job.title }).from(job)
    .where(and(eq(job.id, jobId), eq(job.organizationId, orgId))).limit(1)
  if (!j) throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })

  const [map] = await db.select().from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  const sections = await db.select().from(jobSearchMapSection)
    .where(eq(jobSearchMapSection.mapId, map.id)).orderBy(asc(jobSearchMapSection.displayOrder))
  const items = await db.select().from(jobSearchMapItem)
    .where(eq(jobSearchMapItem.mapId, map.id)).orderBy(asc(jobSearchMapItem.displayOrder))

  const donors = await db.select({
    donor: jobSearchMapDonor,
    company: donorCompany,
  }).from(jobSearchMapDonor)
    .innerJoin(donorCompany, eq(donorCompany.id, jobSearchMapDonor.donorCompanyId))
    .where(eq(jobSearchMapDonor.mapId, map.id))

  const segments = await db.select({
    segment: jobSearchMapSegment,
    channel: sourcingChannel,
  }).from(jobSearchMapSegment)
    .leftJoin(sourcingChannel, eq(sourcingChannel.id, jobSearchMapSegment.channelId))
    .where(eq(jobSearchMapSegment.mapId, map.id))
    .orderBy(asc(jobSearchMapSegment.displayOrder))

  const exportData = {
    jobTitle: j.title,
    versionLabel: map.currentVersionNo > 0 ? `v${map.currentVersionNo}` : undefined,
    summary: map.summary,
    sections: sections.map(s => ({
      title: s.title,
      items: items.filter(i => i.sectionId === s.id).map(i => ({ value: i.value, note: i.note })),
    })),
    donors: donors.map(d => ({
      canonicalName: d.company.canonicalName,
      layer: d.donor.layer,
      priority: d.donor.priority,
      hypothesisStatus: d.donor.hypothesisStatus,
      rationale: d.donor.rationale,
    })),
    segments: segments.map(s => ({
      name: s.segment.name,
      donorLayer: s.segment.donorLayer,
      titles: s.segment.titles,
      geo: s.segment.geo,
      channelCode: s.channel?.code ?? null,
      queryString: s.segment.queryString,
      priority: s.segment.priority,
      hypothesisStatus: s.segment.hypothesisStatus,
    })),
  }

  if (format === 'pdf') {
    const html = exportHtml(exportData)
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return html
  }

  const md = exportMarkdown(exportData)
  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  return md
})
