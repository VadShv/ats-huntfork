import { eq, and, count, desc, sql } from 'drizzle-orm'
import {
  searchMapTemplate, donorCompany, sourcingChannel, jobSearchMap, jobSearchMapDonor,
} from '../../database/schema/app'

/**
 * GET /api/search-map/overview — цифры для страницы «Обзор».
 * Право: searchMap:view. Сид системных каналов + дефолтного шаблона.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId

  await ensureSystemChannels(orgId)
  await ensureDefaultTemplate(orgId)

  const [templateCount] = await db.select({ n: count() }).from(searchMapTemplate)
    .where(eq(searchMapTemplate.organizationId, orgId))

  const [donorCount] = await db.select({ n: count() }).from(donorCompany)
    .where(and(eq(donorCompany.organizationId, orgId), eq(donorCompany.status, 'active')))

  const [channelCount] = await db.select({ n: count() }).from(sourcingChannel)
    .where(eq(sourcingChannel.organizationId, orgId))

  const mapsByStatus = await db.select({
    status: jobSearchMap.status,
    n: count(),
  }).from(jobSearchMap)
    .where(eq(jobSearchMap.organizationId, orgId))
    .groupBy(jobSearchMap.status)

  const topDonors = await db.select({
    id: donorCompany.id,
    canonicalName: donorCompany.canonicalName,
    industry: donorCompany.industry,
    workingCount: count(jobSearchMapDonor.id),
  }).from(donorCompany)
    .innerJoin(jobSearchMapDonor, eq(jobSearchMapDonor.donorCompanyId, donorCompany.id))
    .where(and(eq(donorCompany.organizationId, orgId), eq(jobSearchMapDonor.hypothesisStatus, 'working')))
    .groupBy(donorCompany.id)
    .orderBy(desc(count(jobSearchMapDonor.id)))
    .limit(10)

  return {
    templates: templateCount?.n ?? 0,
    donors: donorCount?.n ?? 0,
    channels: channelCount?.n ?? 0,
    mapsByStatus: Object.fromEntries(mapsByStatus.map(m => [m.status, m.n])),
    topDonors,
  }
})
