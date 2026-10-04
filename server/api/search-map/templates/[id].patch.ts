import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { searchMapTemplate, searchMapTemplateSection } from '../../../database/schema/app'
import { templateSectionInputSchema } from '../../../utils/schemas/searchMap'

const idParamSchema = z.object({ id: z.string().min(1) })
const patchTemplateSchema = z.object({
  code: z.string().min(1).max(50).trim().optional(),
  name: z.string().min(1).max(120).trim().optional(),
  description: z.string().max(2000).nullish(),
  targetRoles: z.array(z.string().max(100)).max(50).optional(),
  generationGuidance: z.string().max(4000).nullish(),
  defaultChannelCodes: z.array(z.string().max(100)).max(20).optional(),
  sections: z.array(templateSectionInputSchema).min(1).max(20).optional(),
}).strict()

/**
 * PATCH /api/search-map/templates/[id] — правка полей и секций (полная замена массива sections).
 * Право: searchMap:manage_registry. Транзакционно.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['manage_registry'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, patchTemplateSchema.parse)

  const [existing] = await db.select().from(searchMapTemplate)
    .where(and(eq(searchMapTemplate.id, id), eq(searchMapTemplate.organizationId, orgId))).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })

  if (body.code && body.code !== existing.code) {
    const [codeConflict] = await db.select({ id: searchMapTemplate.id }).from(searchMapTemplate)
      .where(and(eq(searchMapTemplate.organizationId, orgId), eq(searchMapTemplate.code, body.code))).limit(1)
    if (codeConflict) throw createError({ statusCode: 409, statusMessage: 'Шаблон с таким кодом уже существует' })
  }

  const [updated] = await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (body.code !== undefined) patch.code = body.code
    if (body.name !== undefined) patch.name = body.name
    if (body.description !== undefined) patch.description = body.description
    if (body.targetRoles !== undefined) patch.targetRoles = body.targetRoles
    if (body.generationGuidance !== undefined) patch.generationGuidance = body.generationGuidance
    if (body.defaultChannelCodes !== undefined) patch.defaultChannelCodes = body.defaultChannelCodes

    const [t] = await tx.update(searchMapTemplate).set(patch)
      .where(and(eq(searchMapTemplate.id, id), eq(searchMapTemplate.organizationId, orgId)))
      .returning()

    if (body.sections) {
      await tx.delete(searchMapTemplateSection).where(eq(searchMapTemplateSection.templateId, id))
      for (const s of body.sections) {
        await tx.insert(searchMapTemplateSection).values({
          organizationId: orgId,
          templateId: id,
          sectionType: s.sectionType,
          title: s.title,
          guidance: s.guidance ?? null,
          isRequired: s.isRequired,
          displayOrder: s.displayOrder,
        })
      }
    }

    return [t]
  })

  return updated
})
