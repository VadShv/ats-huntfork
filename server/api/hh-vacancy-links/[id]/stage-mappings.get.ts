/**
 * GET /api/hh-vacancy-links/:id/stage-mappings
 *
 * Список mapping'ов pipeline stage → hh collection для конкретной связки.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hhStageMapping, hhVacancyLink } from '../../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  // Проверяем владение
  const link = await db.query.hhVacancyLink.findFirst({
    where: and(eq(hhVacancyLink.id, id), eq(hhVacancyLink.organizationId, orgId)),
    columns: { id: true },
  })
  if (!link) {
    throw createError({ statusCode: 404, statusMessage: 'Связка hh.ru не найдена' })
  }

  const rows = await db
    .select({
      id: hhStageMapping.id,
      pipelineStageId: hhStageMapping.pipelineStageId,
      hhCollection: hhStageMapping.hhCollection,
      messageTemplate: hhStageMapping.messageTemplate,
      createdAt: hhStageMapping.createdAt,
      updatedAt: hhStageMapping.updatedAt,
    })
    .from(hhStageMapping)
    .where(and(
      eq(hhStageMapping.hhVacancyLinkId, id),
      eq(hhStageMapping.organizationId, orgId),
    ))

  return { mappings: rows }
})
