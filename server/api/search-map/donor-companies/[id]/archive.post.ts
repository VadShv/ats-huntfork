import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { donorCompany } from '../../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/search-map/donor-companies/[id]/archive — soft-архив донора.
 * Право: searchMap:manage_registry. Если используется — 200 с warning.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['manage_registry'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const [existing] = await db.select().from(donorCompany)
    .where(and(eq(donorCompany.id, id), eq(donorCompany.organizationId, orgId))).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Компания не найдена' })

  const [updated] = await db.update(donorCompany).set({
    status: 'archived',
    updatedAt: new Date(),
  }).where(and(eq(donorCompany.id, id), eq(donorCompany.organizationId, orgId))).returning()

  return updated
})
