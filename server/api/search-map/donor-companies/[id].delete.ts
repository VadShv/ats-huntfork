import { eq, and, count } from 'drizzle-orm'
import { z } from 'zod'
import { donorCompany, jobSearchMapDonor } from '../../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * DELETE /api/search-map/donor-companies/[id] — удалить донора.
 * Право: searchMap:manage_registry. Только если usedInMaps = 0 (иначе 409).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['manage_registry'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const [existing] = await db.select().from(donorCompany)
    .where(and(eq(donorCompany.id, id), eq(donorCompany.organizationId, orgId))).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Компания не найдена' })

  const [usage] = await db.select({ n: count(jobSearchMapDonor.id) }).from(jobSearchMapDonor)
    .where(eq(jobSearchMapDonor.donorCompanyId, id))
  if (usage && usage.n > 0) throw createError({ statusCode: 409, statusMessage: `Компания используется в ${usage.n} картах`, data: { usedInMaps: usage.n } })

  await db.delete(donorCompany).where(and(eq(donorCompany.id, id), eq(donorCompany.organizationId, orgId)))

  return { success: true }
})
