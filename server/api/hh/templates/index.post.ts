/**
 * POST /api/hh/templates
 *
 * Create a new reusable vacancy template.
 * Body: { name, description?, vacancyData, isShared?, hhAreaId?, hhProfArea? }
 */
import { eq } from 'drizzle-orm'
import { hhVacancyTemplate } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { hhTemplate: ['create'] })
  const orgId = session.activeOrganizationId

  const body = await readBody<{
    name?: string
    description?: string
    vacancyData?: Record<string, unknown>
    isShared?: boolean
    hhAreaId?: string
    hhProfArea?: string[]
  }>(event)

  const name = (body?.name ?? '').trim()
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Обязательно поле name' })
  }
  if (!body?.vacancyData || typeof body.vacancyData !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Обязательно поле vacancyData' })
  }

  const [created] = await db
    .insert(hhVacancyTemplate)
    .values({
      organizationId: orgId,
      createdByUserId: user.id,
      name,
      description: body.description?.trim() || null,
      vacancyData: body.vacancyData,
      isShared: body.isShared ?? true,
      hhAreaId: body.hhAreaId?.trim() || null,
      hhProfArea: body.hhProfArea ?? null,
    })
    .returning()

  return created
})
