import { eq, and, ne } from 'drizzle-orm'
import { z } from 'zod'
import { searchMapTemplate } from '../../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/search-map/templates/[id]/set-default — назначить шаблон по умолчанию.
 * Право: searchMap:manage_registry. Только published (422).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['manage_registry'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const [template] = await db.select().from(searchMapTemplate)
    .where(and(eq(searchMapTemplate.id, id), eq(searchMapTemplate.organizationId, orgId))).limit(1)
  if (!template) throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })
  if (template.status !== 'published') throw createError({ statusCode: 422, statusMessage: 'Только опубликованный шаблон может быть по умолчанию' })

  await db.transaction(async (tx) => {
    await tx.update(searchMapTemplate).set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(searchMapTemplate.organizationId, orgId), ne(searchMapTemplate.id, id)))
    await tx.update(searchMapTemplate).set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(searchMapTemplate.id, id), eq(searchMapTemplate.organizationId, orgId)))
  })

  return { success: true }
})
