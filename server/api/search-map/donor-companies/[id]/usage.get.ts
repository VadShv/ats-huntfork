import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { donorCompany, jobSearchMapDonor, jobSearchMap, job } from '../../../../database/schema/app'

const paramsSchema = z.object({ id: z.string().min(1) })

/**
 * GET /api/search-map/donor-companies/[id]/usage — в каких вакансиях используется донор.
 * Право: searchMap:view
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { id: companyId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const [company] = await db.select().from(donorCompany)
    .where(and(eq(donorCompany.id, companyId), eq(donorCompany.organizationId, orgId))).limit(1)
  if (!company) throw createError({ statusCode: 404, statusMessage: 'Компания не найдена' })

  const usages = await db.select({
    donorId: jobSearchMapDonor.id,
    layer: jobSearchMapDonor.layer,
    priority: jobSearchMapDonor.priority,
    mapId: jobSearchMap.id,
    jobId: jobSearchMap.jobId,
    jobTitle: job.title,
  }).from(jobSearchMapDonor)
    .innerJoin(jobSearchMap, eq(jobSearchMap.id, jobSearchMapDonor.mapId))
    .innerJoin(job, eq(job.id, jobSearchMap.jobId))
    .where(and(eq(jobSearchMapDonor.donorCompanyId, companyId), eq(jobSearchMapDonor.organizationId, orgId)))

  return { company, usages }
})
