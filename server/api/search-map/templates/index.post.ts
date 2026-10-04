import { eq, and } from 'drizzle-orm'
import { searchMapTemplate, searchMapTemplateSection } from '../../../database/schema/app'
import { templateInputSchema } from '../../../utils/schemas/searchMap'

/**
 * POST /api/search-map/templates — создать шаблон (draft) с секциями.
 * Право: searchMap:manage_registry
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['manage_registry'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, templateInputSchema.parse)

  if (body.code) {
    const [existing] = await db.select({ id: searchMapTemplate.id }).from(searchMapTemplate)
      .where(and(eq(searchMapTemplate.organizationId, orgId), eq(searchMapTemplate.code, body.code))).limit(1)
    if (existing) throw createError({ statusCode: 409, statusMessage: 'Шаблон с таким кодом уже существует' })
  }

  const [created] = await db.transaction(async (tx) => {
    const [template] = await tx.insert(searchMapTemplate).values({
      organizationId: orgId,
      code: body.code ?? null,
      name: body.name,
      description: body.description ?? null,
      targetRoles: body.targetRoles,
      generationGuidance: body.generationGuidance ?? null,
      defaultChannelCodes: body.defaultChannelCodes,
      status: 'draft',
      createdById: session.user.id,
    }).returning()

    for (const s of body.sections) {
      await tx.insert(searchMapTemplateSection).values({
        organizationId: orgId,
        templateId: template.id,
        sectionType: s.sectionType,
        title: s.title,
        guidance: s.guidance ?? null,
        isRequired: s.isRequired,
        displayOrder: s.displayOrder,
      })
    }

    return [template]
  })

  setResponseStatus(event, 201)
  return created
})
