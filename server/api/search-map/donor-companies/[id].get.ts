import { eq, and, count } from 'drizzle-orm'
import { z } from 'zod'
import { donorCompany, jobSearchMapDonor, jobSearchMap } from '../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * GET /api/search-map/donor-companies/[id] — карточка + статистика использования.
 * Право: searchMap:view
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const [company] = await db.select().from(donorCompany)
    .where(and(eq(donorCompany.id, id), eq(donorCompany.organizationId, orgId))).limit(1)
  if (!company) throw createError({ statusCode: 404, statusMessage: 'Компания не найдена' })

  const usage = await db.select({
    mapId: jobSearchMapDonor.mapId,
    layer: jobSearchMapDonor.layer,
    hypothesisStatus: jobSearchMapDonor.hypothesisStatus,
    jobId: jobSearchMap.jobId,
  })
    .from(jobSearchMapDonor)
    .innerJoin(jobSearchMap, eq(jobSearchMap.id, jobSearchMapDonor.mapId))
    .where(and(eq(jobSearchMapDonor.donorCompanyId, id), eq(jobSearchMapDonor.organizationId, orgId)))

  const usedInMaps = usage.length
  const workingInMaps = usage.filter(u => u.hypothesisStatus === 'working').length
  const rejectedInMaps = usage.filter(u => u.hypothesisStatus === 'rejected').length

  return { ...company, usedInMaps, workingInMaps, rejectedInMaps, usage }
})
