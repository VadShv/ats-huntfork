import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { job, jobSearchMap } from '../../../../database/schema/app'
import { loadMapBundle, loadMapVersions } from '../../../../utils/searchMap/loadMapBundle'
import { buildSearchMapDocument } from '../../../../../shared/searchMap/documentModel'
import { renderDocumentHtml, renderDocumentMarkdown } from '../../../../../shared/searchMap/renderDocument'

const idParamSchema = z.object({ id: z.string().min(1) })
const querySchema = z.object({
  format: z.enum(['md', 'pdf', 'html']).optional().default('md'),
  /** print=0 — HTML без автопечати (предпросмотр документа в новой вкладке) */
  print: z.enum(['0', '1']).optional().default('1'),
})

/**
 * GET /api/jobs/[id]/search-map/export?format=md|pdf|html — экспорт карты.
 * Право: searchMap:view.
 *
 * Данные и структура — те же, что у документ-вида на экране (loadMapBundle → buildSearchMapDocument),
 * поэтому PDF и экран не расходятся. docs/tz-search-map-v2.md §3.2.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  await requireJobInScope(event, jobId)
  const q = querySchema.parse(getQuery(event))

  const [j] = await db.select({ title: job.title }).from(job)
    .where(and(eq(job.id, jobId), eq(job.organizationId, orgId))).limit(1)
  if (!j) throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })

  const [map] = await db.select().from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  const [bundle, versions, hashes] = await Promise.all([
    loadMapBundle(map.id),
    loadMapVersions(map.id),
    computeSourceHashes(jobId, orgId),
  ])
  const staleSources = (['brief', 'criteria', 'description'] as const).filter(k => hashes[k] !== map.sourceHashes[k])

  const doc = buildSearchMapDocument({
    jobTitle: j.title,
    map,
    sections: bundle.sections,
    donors: bundle.donors,
    segments: bundle.segments,
    versions,
    staleSources,
  })

  if (q.format === 'pdf' || q.format === 'html') {
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return renderDocumentHtml(doc, { autoPrint: q.format === 'pdf' && q.print === '1' })
  }

  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  return renderDocumentMarkdown(doc)
})
