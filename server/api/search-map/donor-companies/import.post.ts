import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { donorCompany } from '../../../database/schema/app'
import { normalizeCompanyName } from '../../../utils/searchMap/normalizeCompanyName'

const bodySchema = z.object({
  companies: z.array(z.object({
    name: z.string().min(1).max(200),
    industry: z.string().max(200).optional(),
    layer: z.enum(['core', 'adjacent', 'school', 'alumni', 'custom']).optional(),
  })).min(1).max(500),
})

/**
 * POST /api/search-map/donor-companies/import — импорт компаний из CSV/массива.
 * Право: searchMap:add_donor
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['add_donor'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const body = await readValidatedBody(event, bodySchema.parse)

  let created = 0, skipped = 0

  for (const c of body.companies) {
    const normalized = normalizeCompanyName(c.name)
    const [existing] = await db.select({ id: donorCompany.id }).from(donorCompany)
      .where(and(eq(donorCompany.organizationId, orgId), eq(donorCompany.normalizedName, normalized))).limit(1)

    if (existing) {
      skipped++
      continue
    }

    await db.insert(donorCompany).values({
      organizationId: orgId,
      canonicalName: c.name,
      normalizedName: normalized,
      industry: c.industry ?? null,
      createdById: userId,
    })
    created++
  }

  return { created, skipped, total: body.companies.length }
})
