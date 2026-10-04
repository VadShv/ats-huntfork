import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMap } from '../../../../database/schema/app'
import { computeSourceHashes } from '../../../../utils/searchMap/sourceHashes'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/jobs/[id]/search-map/acknowledge-sources
 * Сбросить stale-флаг: обновить sourceHashes до текущих.
 * Право: searchMap:edit
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  await requireJobInScope(event, jobId)

  const [map] = await db.select().from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  const hashes = await computeSourceHashes(jobId, orgId)

  await db.update(jobSearchMap).set({
    sourceHashes: hashes,
    updatedAt: new Date(),
  }).where(eq(jobSearchMap.id, map.id))

  return { ok: true }
})
