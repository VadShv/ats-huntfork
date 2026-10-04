import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMapDonor } from '../../../../../database/schema/app'

const paramsSchema = z.object({ id: z.string().min(1), donorId: z.string().min(1) })

/**
 * DELETE /api/jobs/[id]/search-map/donors/[donorId] — удалить донора из карты (реестр не трогается).
 * Право: searchMap:edit
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId, donorId } = await getValidatedRouterParams(event, paramsSchema.parse)
  await requireJobInScope(event, jobId)

  const [existing] = await db.select({ id: jobSearchMapDonor.id }).from(jobSearchMapDonor)
    .where(and(eq(jobSearchMapDonor.id, donorId), eq(jobSearchMapDonor.organizationId, orgId))).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Донор не найден' })

  await db.delete(jobSearchMapDonor).where(and(eq(jobSearchMapDonor.id, donorId), eq(jobSearchMapDonor.organizationId, orgId)))

  return { success: true }
})
