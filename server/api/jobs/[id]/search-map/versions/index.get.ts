import { eq, and, desc } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMap, jobSearchMapVersion } from '../../../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * GET /api/jobs/[id]/search-map/versions — список версий.
 * Право: searchMap:view
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  await requireJobInScope(event, jobId)

  const [map] = await db.select().from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  const versions = await db.select({
    id: jobSearchMapVersion.id,
    versionNo: jobSearchMapVersion.versionNo,
    label: jobSearchMapVersion.label,
    trigger: jobSearchMapVersion.trigger,
    comment: jobSearchMapVersion.comment,
    diffSummary: jobSearchMapVersion.diffSummary,
    createdAt: jobSearchMapVersion.createdAt,
  }).from(jobSearchMapVersion)
    .where(eq(jobSearchMapVersion.mapId, map.id))
    .orderBy(desc(jobSearchMapVersion.versionNo))

  return { versions, currentVersionNo: map.currentVersionNo }
})
