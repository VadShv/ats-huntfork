import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { donorCompany, jobSearchMapDonor } from '../../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })
const mergeSchema = z.object({ intoId: z.string().min(1) })

/**
 * POST /api/search-map/donor-companies/[id]/merge — объединить дублей.
 * Право: searchMap:manage_registry. Перенос связей, объединение алиасов, status='merged'.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['manage_registry'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, mergeSchema.parse)

  const [source] = await db.select().from(donorCompany)
    .where(and(eq(donorCompany.id, id), eq(donorCompany.organizationId, orgId))).limit(1)
  if (!source) throw createError({ statusCode: 404, statusMessage: 'Исходная компания не найдена' })

  const [target] = await db.select().from(donorCompany)
    .where(and(eq(donorCompany.id, body.intoId), eq(donorCompany.organizationId, orgId))).limit(1)
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Целевая компания не найдена' })
  if (target.status === 'merged') throw createError({ statusCode: 409, statusMessage: 'Целевая компания уже объединена' })

  await db.transaction(async (tx) => {
    await tx.update(jobSearchMapDonor).set({ donorCompanyId: body.intoId })
      .where(eq(jobSearchMapDonor.donorCompanyId, id))

    const mergedAliases = [...new Set([...(source.aliases || []), ...(target.aliases || []), source.canonicalName])]
    const { normalizeCompanyName } = await import('../../../../utils/searchMap/normalizeCompanyName')
    const mergedNormalizedAliases = mergedAliases.map(normalizeCompanyName)

    await tx.update(donorCompany).set({
      aliases: mergedAliases,
      normalizedAliases: mergedNormalizedAliases,
      updatedAt: new Date(),
    }).where(eq(donorCompany.id, body.intoId))

    await tx.update(donorCompany).set({
      status: 'merged',
      mergedIntoId: body.intoId,
      updatedAt: new Date(),
    }).where(eq(donorCompany.id, id))
  })

  return { success: true, mergedIntoId: body.intoId }
})
