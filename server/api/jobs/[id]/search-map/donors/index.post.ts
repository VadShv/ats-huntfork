import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMap, jobSearchMapDonor, donorCompany } from '../../../../../database/schema/app'
import { mapDonorInputSchema } from '../../../../../utils/schemas/searchMap'
import { normalizeCompanyName } from '../../../../../utils/searchMap/normalizeCompanyName'

const idParamSchema = z.object({ id: z.string().min(1) })
const addDonorsSchema = z.object({ donors: z.array(mapDonorInputSchema).min(1).max(50) })

/**
 * POST /api/jobs/[id]/search-map/donors — bulk-добавление доноров в карту.
 * Право: searchMap:edit (+ add_donor если создаётся новая запись реестра).
 * resolveOrCreateDonor: нашёл — связывает; не нашёл — создаёт в реестре.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, addDonorsSchema.parse)
  await requireJobInScope(event, jobId)

  const [map] = await db.select({ id: jobSearchMap.id }).from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  let added = 0, linkedExisting = 0, createdInRegistry = 0, skippedDuplicates = 0

  for (const d of body.donors) {
    let donorCompanyId = d.donorCompanyId

    if (!donorCompanyId && d.name) {
      const normalized = normalizeCompanyName(d.name)
      const [existing] = await db.select({ id: donorCompany.id }).from(donorCompany)
        .where(and(eq(donorCompany.organizationId, orgId), eq(donorCompany.normalizedName, normalized))).limit(1)

      if (existing) {
        donorCompanyId = existing.id
        linkedExisting++
      } else {
        const [created] = await db.insert(donorCompany).values({
          organizationId: orgId,
          canonicalName: d.name,
          normalizedName: normalized,
          aliases: d.aliases || [],
          normalizedAliases: (d.aliases || []).map(normalizeCompanyName),
          industry: d.industry ?? null,
          techStack: d.techStack || [],
          createdById: session.user.id,
          createdFromJobId: jobId,
        }).returning()
        donorCompanyId = created.id
        createdInRegistry++
      }
    }

    if (!donorCompanyId) continue

    const [existingInMap] = await db.select({ id: jobSearchMapDonor.id }).from(jobSearchMapDonor)
      .where(and(eq(jobSearchMapDonor.mapId, map.id), eq(jobSearchMapDonor.donorCompanyId, donorCompanyId))).limit(1)
    if (existingInMap) { skippedDuplicates++; continue }

    await db.insert(jobSearchMapDonor).values({
      organizationId: orgId,
      mapId: map.id,
      donorCompanyId,
      layer: d.layer,
      priority: d.priority,
      rationale: d.rationale ?? null,
      origin: d.origin,
      displayOrder: added,
    })
    added++
  }

  return { added, linkedExisting, createdInRegistry, skippedDuplicates }
})
