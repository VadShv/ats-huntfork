import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMapSegment, sourcingChannel } from '../../../../../database/schema/app'
import { segmentBaseSchema } from '../../../../../utils/schemas/searchMap'
import { buildSegmentName, buildQueryUrl } from '../../../../../utils/searchMap/buildQueryUrl'

const paramsSchema = z.object({ id: z.string().min(1), segmentId: z.string().min(1) })
const patchSegmentSchema = segmentBaseSchema.partial().strict()

/**
 * PATCH /api/jobs/[id]/search-map/segments/[segmentId] — правка сегмента.
 * Право: searchMap:edit. Пересчёт name (если пустое) и queryUrl. rejected требует resultNote.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId, segmentId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, patchSegmentSchema.parse)
  await requireJobInScope(event, jobId)

  const [existing] = await db.select().from(jobSearchMapSegment)
    .where(and(eq(jobSearchMapSegment.id, segmentId), eq(jobSearchMapSegment.organizationId, orgId))).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Сегмент не найден' })

  const newStatus = body.hypothesisStatus ?? existing.hypothesisStatus
  const newResultNote = body.resultNote ?? existing.resultNote
  if (newStatus === 'rejected' && !newResultNote) {
    throw createError({ statusCode: 400, statusMessage: 'Укажите результат при отклонении' })
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  const titles = body.titles ?? existing.titles
  const geo = body.geo ?? existing.geo
  const donorLayer = body.donorLayer ?? existing.donorLayer
  const channelId = body.channelId ?? existing.channelId
  const queryString = body.queryString ?? existing.queryString

  if (body.name !== undefined) patch.name = body.name
  if (body.donorLayer !== undefined) patch.donorLayer = body.donorLayer
  if (body.donorIds !== undefined) patch.donorIds = body.donorIds
  if (body.titles !== undefined) patch.titles = body.titles
  if (body.keywords !== undefined) patch.keywords = body.keywords
  if (body.geo !== undefined) patch.geo = body.geo
  if (body.channelId !== undefined) patch.channelId = body.channelId
  if (body.queryString !== undefined) patch.queryString = body.queryString
  if (body.priority !== undefined) patch.priority = body.priority
  if (body.poolEstimate !== undefined) patch.poolEstimate = body.poolEstimate
  if (body.responseLikelihood !== undefined) patch.responseLikelihood = body.responseLikelihood
  if (body.accessDifficulty !== undefined) patch.accessDifficulty = body.accessDifficulty
  if (body.rationale !== undefined) patch.rationale = body.rationale
  if (body.resultNote !== undefined) patch.resultNote = body.resultNote
  if (body.displayOrder !== undefined) patch.displayOrder = body.displayOrder

  if (body.origin !== undefined) {
    if (existing.origin === 'ai' && (body.name !== undefined || body.titles !== undefined || body.keywords !== undefined)) {
      patch.origin = 'manual'
    } else if (body.origin !== undefined) {
      patch.origin = body.origin
    }
  }

  if (!body.name && (body.donorLayer !== undefined || body.titles !== undefined || body.geo !== undefined || body.channelId !== undefined)) {
    const [channel] = channelId ? await db.select().from(sourcingChannel).where(eq(sourcingChannel.id, channelId)).limit(1) : [null]
    patch.name = buildSegmentName({ donorLayer: donorLayer ?? null, titles, geo, channelName: channel?.name ?? null })
  }

  if (body.queryString !== undefined || body.channelId !== undefined) {
    const [channel] = channelId ? await db.select().from(sourcingChannel).where(eq(sourcingChannel.id, channelId)).limit(1) : [null]
    patch.queryUrl = buildQueryUrl({
      queryString,
      urlTemplate: channel?.urlTemplate ?? null,
      targetSite: channel?.targetSite ?? null,
      titles,
      geo,
    })
  }

  if (newStatus !== existing.hypothesisStatus) {
    patch.hypothesisStatus = newStatus
    patch.statusChangedAt = new Date()
    patch.statusChangedById = session.user.id
  }

  const [updated] = await db.update(jobSearchMapSegment).set(patch)
    .where(and(eq(jobSearchMapSegment.id, segmentId), eq(jobSearchMapSegment.organizationId, orgId)))
    .returning()

  return updated
})
