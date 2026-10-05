import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { donorCompany } from '../../../database/schema/app'
import { normalizeCompanyName } from '../../../../utils/searchMap/normalizeCompanyName'

const idParamSchema = z.object({ id: z.string().min(1) })
const patchDonorSchema = z.object({
  canonicalName: z.string().min(1).max(160).trim().optional(),
  aliases: z.array(z.string().min(1).max(160).trim()).max(50).optional(),
  website: z.string().url().max(500).nullish(),
  hhEmployerId: z.string().max(50).nullish(),
  industry: z.string().max(100).nullish(),
  techStack: z.array(z.string().max(100)).max(100).optional(),
  sizeBand: z.enum(['1-50', '51-200', '201-1000', '1000+']).nullish(),
  stage: z.enum(['startup', 'growth', 'enterprise', 'state']).nullish(),
  country: z.string().max(100).nullish(),
  city: z.string().max(100).nullish(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  notes: z.string().max(2000).nullish(),
}).strict()

/**
 * PATCH /api/search-map/donor-companies/[id] — правка донора.
 * manage_registry (любые поля) / add_donor (только aliases).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['add_donor'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, patchDonorSchema.parse)

  const [existing] = await db.select().from(donorCompany)
    .where(and(eq(donorCompany.id, id), eq(donorCompany.organizationId, orgId))).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Компания не найдена' })

  const patch: Record<string, unknown> = { updatedAt: new Date() }

  if (body.canonicalName && body.canonicalName !== existing.canonicalName) {
    const normalized = normalizeCompanyName(body.canonicalName)
    const [conflict] = await db.select({ id: donorCompany.id }).from(donorCompany)
      .where(and(eq(donorCompany.organizationId, orgId), eq(donorCompany.normalizedName, normalized))).limit(1)
    if (conflict) throw createError({ statusCode: 409, statusMessage: 'Компания с таким именем уже существует' })
    patch.canonicalName = body.canonicalName
    patch.normalizedName = normalized
  }

  if (body.aliases) {
    patch.aliases = body.aliases
    patch.normalizedAliases = body.aliases.map(normalizeCompanyName)
  }
  if (body.website !== undefined) patch.website = body.website
  if (body.hhEmployerId !== undefined) patch.hhEmployerId = body.hhEmployerId
  if (body.industry !== undefined) patch.industry = body.industry
  if (body.techStack !== undefined) patch.techStack = body.techStack
  if (body.sizeBand !== undefined) patch.sizeBand = body.sizeBand
  if (body.stage !== undefined) patch.stage = body.stage
  if (body.country !== undefined) patch.country = body.country
  if (body.city !== undefined) patch.city = body.city
  if (body.tags !== undefined) patch.tags = body.tags
  if (body.notes !== undefined) patch.notes = body.notes

  const [updated] = await db.update(donorCompany).set(patch)
    .where(and(eq(donorCompany.id, id), eq(donorCompany.organizationId, orgId)))
    .returning()

  return updated
})
