import { eq, and, asc } from 'drizzle-orm'
import { z } from 'zod'
import { searchMapTemplate, searchMapTemplateSection } from '../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * GET /api/search-map/templates/[id] — шаблон с секциями.
 * Право: searchMap:view
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const [template] = await db.select().from(searchMapTemplate)
    .where(and(eq(searchMapTemplate.id, id), eq(searchMapTemplate.organizationId, orgId))).limit(1)
  if (!template) throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })

  const sections = await db.select().from(searchMapTemplateSection)
    .where(eq(searchMapTemplateSection.templateId, id))
    .orderBy(asc(searchMapTemplateSection.displayOrder))

  return { ...template, sections }
})
