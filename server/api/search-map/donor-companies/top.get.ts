import { eq, and, desc, count } from 'drizzle-orm'
import { z } from 'zod'
import { donorCompany, jobSearchMapDonor } from '../../../database/schema/app'

/**
 * GET /api/search-map/donor-companies/top — топ доноров по использованию.
 * Право: searchMap:view
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId
  const limit = Math.min(Number(getQuery(event).limit ?? 10), 50)

  const top = await db.select({
    id: donorCompany.id,
    canonicalName: donorCompany.canonicalName,
    industry: donorCompany.industry,
    usageCount: count(jobSearchMapDonor.id),
  }).from(donorCompany)
    .leftJoin(jobSearchMapDonor, eq(jobSearchMapDonor.donorCompanyId, donorCompany.id))
    .where(eq(donorCompany.organizationId, orgId))
    .groupBy(donorCompany.id)
    .orderBy(desc(count(jobSearchMapDonor.id)))
    .limit(limit)

  return { items: top }
})
