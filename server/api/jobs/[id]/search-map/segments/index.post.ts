import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMap, jobSearchMapSegment, sourcingChannel } from '../../../../../database/schema/app'
import { segmentInputSchema } from '../../../../../utils/schemas/searchMap'
import { buildSegmentName, buildQueryUrl } from '../../../../../utils/searchMap/buildQueryUrl'

const idParamSchema = z.object({ id: z.string().min(1) })
const addSegmentsSchema = z.object({ segments: z.array(segmentInputSchema).min(1).max(50) })

/**
 * POST /api/jobs/[id]/search-map/segments — bulk-добавление сегментов.
 * Право: searchMap:edit. Автособирает name и queryUrl.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, addSegmentsSchema.parse)
  await requireJobInScope(event, jobId)

  const [map] = await db.select({ id: jobSearchMap.id }).from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  const channels = await db.select().from(sourcingChannel)
    .where(eq(sourcingChannel.organizationId, orgId))
  const channelMap = new Map(channels.map(c => [c.id, c]))

  const created: typeof jobSearchMapSegment.$inferSelect[] = []

  for (let i = 0; i < body.segments.length; i++) {
    const s = body.segments[i]
    const channel = s.channelId ? channelMap.get(s.channelId) : null

    const name = s.name || buildSegmentName({
      donorLayer: s.donorLayer,
      titles: s.titles,
      geo: s.geo,
      channelName: channel?.name ?? null,
    })

    const queryUrl = buildQueryUrl({
      queryString: s.queryString,
      urlTemplate: channel?.urlTemplate ?? null,
      targetSite: channel?.targetSite ?? null,
      titles: s.titles,
      geo: s.geo,
    })

    const [seg] = await db.insert(jobSearchMapSegment).values({
      organizationId: orgId,
      mapId: map.id,
      name,
      donorLayer: s.donorLayer ?? null,
      donorIds: s.donorIds,
      titles: s.titles,
      keywords: s.keywords,
      geo: s.geo,
      channelId: s.channelId ?? null,
      queryString: s.queryString ?? null,
      queryUrl,
      priority: s.priority,
      poolEstimate: s.poolEstimate ?? null,
      responseLikelihood: s.responseLikelihood ?? null,
      accessDifficulty: s.accessDifficulty ?? null,
      hypothesisStatus: s.hypothesisStatus,
      rationale: s.rationale ?? null,
      resultNote: s.resultNote ?? null,
      origin: s.origin,
      displayOrder: i,
    }).returning()

    created.push(seg)
  }

  setResponseStatus(event, 201)
  return { items: created }
})
