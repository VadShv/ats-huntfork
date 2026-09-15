/**
 * PUT /api/hh/templates/:id
 *
 * Update an existing vacancy template. Only the creator or an admin
 * (delete permission) can edit a private template; shared templates
 * require update permission.
 */
import { and, eq } from 'drizzle-orm'
import { hhVacancyTemplate } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { hhTemplate: ['update'] })
  const orgId = session.activeOrganizationId
  const templateId = getRouterParam(event, 'id')

  if (!templateId) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан ID шаблона' })
  }

  const [existing] = await db
    .select()
    .from(hhVacancyTemplate)
    .where(and(eq(hhVacancyTemplate.id, templateId), eq(hhVacancyTemplate.organizationId, orgId)))
    .limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })
  }

  // Private template: only creator can edit
  if (!existing.isShared && existing.createdByUserId !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Нет прав на редактирование' })
  }

  const body = await readBody<{
    name?: string
    description?: string
    vacancyData?: Record<string, unknown>
    isShared?: boolean
    hhAreaId?: string
    hhProfArea?: string[]
  }>(event)

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body?.name !== undefined) updates.name = body.name.trim()
  if (body?.description !== undefined) updates.description = body.description?.trim() || null
  if (body?.vacancyData !== undefined) updates.vacancyData = body.vacancyData
  if (body?.isShared !== undefined) updates.isShared = body.isShared
  if (body?.hhAreaId !== undefined) updates.hhAreaId = body.hhAreaId?.trim() || null
  if (body?.hhProfArea !== undefined) updates.hhProfArea = body.hhProfArea

  const [updated] = await db
    .update(hhVacancyTemplate)
    .set(updates)
    .where(eq(hhVacancyTemplate.id, templateId))
    .returning()

  return updated
})
