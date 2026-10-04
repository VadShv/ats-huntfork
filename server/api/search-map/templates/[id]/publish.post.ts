import { eq, and, count } from 'drizzle-orm'
import { z } from 'zod'
import { searchMapTemplate, searchMapTemplateSection } from '../../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/search-map/templates/[id]/publish — публикация шаблона (version++).
 * Право: searchMap:manage_registry. 422, если нет ни одной секции.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['manage_registry'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const [template] = await db.select().from(searchMapTemplate)
    .where(and(eq(searchMapTemplate.id, id), eq(searchMapTemplate.organizationId, orgId))).limit(1)
  if (!template) throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })

  const [sectionCount] = await db.select({ n: count(searchMapTemplateSection.id) })
    .from(searchMapTemplateSection).where(eq(searchMapTemplateSection.templateId, id))
  if (!sectionCount || sectionCount.n === 0) throw createError({ statusCode: 422, statusMessage: 'Нельзя опубликовать шаблон без секций' })

  const [updated] = await db.update(searchMapTemplate).set({
    status: 'published',
    version: template.version + 1,
    publishedAt: new Date(),
    publishedById: session.user.id,
    updatedAt: new Date(),
  }).where(and(eq(searchMapTemplate.id, id), eq(searchMapTemplate.organizationId, orgId))).returning()

  return updated
})
