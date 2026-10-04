import { eq, and, max } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMap, jobSearchMapVersion } from '../../../../../database/schema/app'
import { snapshotMap } from '../../../../../utils/searchMap/snapshotMap'
import { computeSourceHashes } from '../../../../../utils/searchMap/sourceHashes'

const idParamSchema = z.object({ id: z.string().min(1) })

const bodySchema = z.object({
  label: z.string().min(1).max(200).optional(),
  comment: z.string().max(2000).optional(),
}).optional()

/**
 * POST /api/jobs/[id]/search-map/versions — создать версию (снапшот).
 * Право: searchMap:edit
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  await requireJobInScope(event, jobId)
  const body = await readValidatedBody(event, (b) => bodySchema.safeParse(b).data ?? {})

  const [map] = await db.select().from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  const snapshot = await snapshotMap(map.id)
  const hashes = await computeSourceHashes(jobId, orgId)

  const versionNo = map.currentVersionNo + 1
  const label = body?.label ?? `Версия ${versionNo}`

  await db.insert(jobSearchMapVersion).values({
    mapId: map.id,
    organizationId: orgId as string,
    versionNo,
    label,
    trigger: 'manual',
    snapshot,
    sourceHashes: hashes,
    comment: body?.comment ?? null,
    createdById: userId,
  })

  await db.update(jobSearchMap).set({
    currentVersionNo: versionNo,
    sourceHashes: hashes,
    updatedAt: new Date(),
  }).where(eq(jobSearchMap.id, map.id))

  return { versionNo, label }
})
