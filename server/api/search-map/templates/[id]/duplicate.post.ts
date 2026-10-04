import { eq, and, asc } from 'drizzle-orm'
import { z } from 'zod'
import { searchMapTemplate, searchMapTemplateSection } from '../../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/search-map/templates/[id]/duplicate — копия шаблона в draft.
 * Право: searchMap:manage_registry
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['manage_registry'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const [template] = await db.select().from(searchMapTemplate)
    .where(and(eq(searchMapTemplate.id, id), eq(searchMapTemplate.organizationId, orgId))).limit(1)
  if (!template) throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })

  const sections = await db.select().from(searchMapTemplateSection)
    .where(eq(searchMapTemplateSection.templateId, id)).orderBy(asc(searchMapTemplateSection.displayOrder))

  const [created] = await db.transaction(async (tx) => {
    const [copy] = await tx.insert(searchMapTemplate).values({
      organizationId: orgId,
      code: template.code ? `${template.code}-copy` : null,
      name: `${template.name} (копия)`,
      description: template.description,
      targetRoles: template.targetRoles,
      generationGuidance: template.generationGuidance,
      defaultChannelCodes: template.defaultChannelCodes,
      isDefault: false,
      status: 'draft',
      version: 1,
      createdById: session.user.id,
    }).returning()

    for (const s of sections) {
      await tx.insert(searchMapTemplateSection).values({
        organizationId: orgId,
        templateId: copy.id,
        sectionType: s.sectionType,
        title: s.title,
        guidance: s.guidance,
        isRequired: s.isRequired,
        displayOrder: s.displayOrder,
      })
    }

    return [copy]
  })

  setResponseStatus(event, 201)
  return created
})
