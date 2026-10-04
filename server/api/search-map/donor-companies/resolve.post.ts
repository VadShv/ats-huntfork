import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { donorCompany } from '../../../database/schema/app'
import { normalizeCompanyName } from '../../../utils/searchMap/normalizeCompanyName'

const resolveSchema = z.object({
  names: z.array(z.string().min(1).max(160)).min(1).max(100),
})

/**
 * POST /api/search-map/donor-companies/resolve — разрешить имена без создания.
 * Право: searchMap:view. Возвращает {resolved: [{name, donorCompanyId|null, matchedBy}]}.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, resolveSchema.parse)

  const resolved = await Promise.all(body.names.map(async (name) => {
    const normalized = normalizeCompanyName(name)
    const [byName] = await db.select({ id: donorCompany.id }).from(donorCompany)
      .where(and(eq(donorCompany.organizationId, orgId), eq(donorCompany.normalizedName, normalized))).limit(1)
    if (byName) return { name, donorCompanyId: byName.id, matchedBy: 'name' as const }

    const [byAlias] = await db.select({ id: donorCompany.id }).from(donorCompany)
      .where(and(eq(donorCompany.organizationId, orgId), eq(donorCompany.status, 'active'))).limit(1)
    // TODO: GIN search on normalizedAliases — for now, exact match on normalizedAliases array
    const allActive = await db.select({ id: donorCompany.id, normalizedAliases: donorCompany.normalizedAliases }).from(donorCompany)
      .where(and(eq(donorCompany.organizationId, orgId), eq(donorCompany.status, 'active')))
    const aliasMatch = allActive.find(d => d.normalizedAliases.includes(normalized))
    if (aliasMatch) return { name, donorCompanyId: aliasMatch.id, matchedBy: 'alias' as const }

    return { name, donorCompanyId: null, matchedBy: null }
  }))

  return { resolved }
})
