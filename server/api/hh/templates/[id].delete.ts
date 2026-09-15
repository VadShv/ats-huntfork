/**
 * DELETE /api/hh/templates/:id
 *
 * Delete a vacancy template. Private templates can be deleted by
 * their creator; shared templates require delete permission.
 */
import { and, eq } from 'drizzle-orm'
import { hhVacancyTemplate } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { hhTemplate: ['delete'] })
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

  await db
    .delete(hhVacancyTemplate)
    .where(eq(hhVacancyTemplate.id, templateId))

  return { success: true }
})
