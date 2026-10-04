import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMapSegment } from '../../../../../database/schema/app'

const paramsSchema = z.object({ id: z.string().min(1), segmentId: z.string().min(1) })

/**
 * POST /api/jobs/[id]/search-map/segments/[segmentId]/archive — архивировать сегмент.
 * Право: searchMap:edit. hh-поиски сохраняют связь.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId, segmentId } = await getValidatedRouterParams(event, paramsSchema.parse)
  await requireJobInScope(event, jobId)

  const [updated] = await db.update(jobSearchMapSegment).set({
    isArchived: true,
    updatedAt: new Date(),
  }).where(and(eq(jobSearchMapSegment.id, segmentId), eq(jobSearchMapSegment.organizationId, orgId))).returning()

  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Сегмент не найден' })

  return updated
})
