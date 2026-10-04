import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMap, jobSearchMapVersion } from '../../../../../../database/schema/app'

const paramsSchema = z.object({ id: z.string().min(1), versionId: z.string().min(1) })

/**
 * GET /api/jobs/[id]/search-map/versions/[versionId] — версия со снапшотом.
 * Право: searchMap:view
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId, versionId } = await getValidatedRouterParams(event, paramsSchema.parse)
  await requireJobInScope(event, jobId)

  const [map] = await db.select().from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  const [version] = await db.select().from(jobSearchMapVersion)
    .where(and(eq(jobSearchMapVersion.mapId, map.id), eq(jobSearchMapVersion.id, versionId))).limit(1)
  if (!version) throw createError({ statusCode: 404, statusMessage: 'Версия не найдена' })

  return version
})
