import { eq, and } from 'drizzle-orm'
import { donorCompany } from '../../../database/schema/app'
import { donorCompanyInputSchema } from '../../../utils/schemas/searchMap'
import { normalizeCompanyName } from '../../../utils/searchMap/normalizeCompanyName'

/**
 * POST /api/search-map/donor-companies — создать донора.
 * Право: searchMap:add_donor. 409 {existingId} при совпадении normalizedName.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['add_donor'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, donorCompanyInputSchema.parse)

  const normalized = normalizeCompanyName(body.canonicalName)
  const normalizedAliases = (body.aliases || []).map(normalizeCompanyName)

  const [existing] = await db.select({ id: donorCompany.id }).from(donorCompany)
    .where(and(eq(donorCompany.organizationId, orgId), eq(donorCompany.normalizedName, normalized))).limit(1)
  if (existing) throw createError({ statusCode: 409, statusMessage: 'Компания уже существует', data: { existingId: existing.id } })

  const [created] = await db.insert(donorCompany).values({
    organizationId: orgId,
    canonicalName: body.canonicalName,
    normalizedName: normalized,
    aliases: body.aliases || [],
    normalizedAliases,
    website: body.website ?? null,
    hhEmployerId: body.hhEmployerId ?? null,
    industry: body.industry ?? null,
    techStack: body.techStack || [],
    sizeBand: body.sizeBand ?? null,
    stage: body.stage ?? null,
    country: body.country ?? null,
    city: body.city ?? null,
    tags: body.tags || [],
    notes: body.notes ?? null,
    createdById: session.user.id,
  }).returning()

  setResponseStatus(event, 201)
  return created
})
