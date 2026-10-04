import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { searchMapTemplate } from '../../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/search-map/templates/[id]/archive — soft-архив шаблона.
 * Право: searchMap:manage_registry. Архив дефолтного → 409.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['manage_registry'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const [template] = await db.select().from(searchMapTemplate)
    .where(and(eq(searchMapTemplate.id, id), eq(searchMapTemplate.organizationId, orgId))).limit(1)
  if (!template) throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })
  if (template.isDefault) throw createError({ statusCode: 409, statusMessage: 'Назначьте другой шаблон по умолчанию перед архивацией' })

  const [updated] = await db.update(searchMapTemplate).set({
    status: 'archived',
    updatedAt: new Date(),
  }).where(and(eq(searchMapTemplate.id, id), eq(searchMapTemplate.organizationId, orgId))).returning()

  return updated
})
