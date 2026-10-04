import { eq, and, ilike, or, asc, desc, sql, count } from 'drizzle-orm'
import { donorCompany, jobSearchMapDonor } from '../../../database/schema/app'
import { normalizeCompanyName } from '../../../utils/searchMap/normalizeCompanyName'

/**
 * GET /api/search-map/donor-companies — реестр доноров с поиском/фильтрами/пагинацией.
 * Право: searchMap:view
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId

  const q = getQuery(event)
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
  const offset = Math.max(Number(q.offset) || 0, 0)
  const search = typeof q.search === 'string' ? q.search.trim() : ''
  const statusFilter = typeof q.status === 'string' ? q.status : undefined
  const industryFilter = typeof q.industry === 'string' ? q.industry : undefined
  const tagFilter = typeof q.tag === 'string' ? q.tag : undefined
  const sort = typeof q.sort === 'string' ? q.sort : 'name'

  const conds = [eq(donorCompany.organizationId, orgId)]
  if (search) {
    conds.push(or(
      ilike(donorCompany.canonicalName, `%${search}%`),
      ilike(donorCompany.normalizedName, `%${normalizeCompanyName(search)}%`),
    )!)
  }
  if (statusFilter) conds.push(eq(donorCompany.status, statusFilter as 'active' | 'archived' | 'merged'))
  if (industryFilter) conds.push(ilike(donorCompany.industry, `%${industryFilter}%`))

  const orderBy = sort === 'createdAt' ? desc(donorCompany.createdAt)
    : sort === 'usage' ? desc(count(jobSearchMapDonor.id))
    : asc(donorCompany.canonicalName)

  const items = await db.select({
    id: donorCompany.id,
    canonicalName: donorCompany.canonicalName,
    aliases: donorCompany.aliases,
    website: donorCompany.website,
    industry: donorCompany.industry,
    techStack: donorCompany.techStack,
    sizeBand: donorCompany.sizeBand,
    stage: donorCompany.stage,
    country: donorCompany.country,
    city: donorCompany.city,
    tags: donorCompany.tags,
    status: donorCompany.status,
    createdAt: donorCompany.createdAt,
    usedInMaps: count(jobSearchMapDonor.id),
  })
    .from(donorCompany)
    .leftJoin(jobSearchMapDonor, eq(jobSearchMapDonor.donorCompanyId, donorCompany.id))
    .where(and(...conds))
    .groupBy(donorCompany.id)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)

  const [totalRow] = await db.select({ n: count() }).from(donorCompany).where(and(...conds))

  return { items, total: totalRow?.n ?? 0, limit, offset }
})
