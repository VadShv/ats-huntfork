/**
 * PUT /api/hh-vacancy-links/:id/stage-mappings
 *
 * Заменить все mapping'ы для связки (full-replace).
 * Body: { mappings: [{ pipelineStageId, hhCollection, messageTemplate? }, ...] }
 *
 * Спринт 11.5: допустимые значения hh_collection — реальные коллекции работодателя hh.ru.
 * Спринт 22 (фикс A4): добавлены discard_after_interview и discard_visible_by_opponent —
 * pushAction давно их поддерживает (COLLECTION_PRIORITY), теперь их можно настроить и через UI.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hhStageMapping, hhVacancyLink } from '../../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })

const HH_COLLECTIONS = [
  'response',
  'consider',
  'phone_interview',
  'assessment',
  'interview',
  'offer',
  'hired',
  'discard_by_employer',
  'discard_after_interview',
  'discard_visible_by_opponent',
] as const

const bodySchema = z.object({
  mappings: z.array(z.object({
    pipelineStageId: z.string().min(1),
    hhCollection: z.enum(HH_COLLECTIONS),
    messageTemplate: z.string().max(5000).nullable().optional(),
  })).max(50),
}).strict()

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  // Проверяем владение
  const link = await db.query.hhVacancyLink.findFirst({
    where: and(eq(hhVacancyLink.id, id), eq(hhVacancyLink.organizationId, orgId)),
    columns: { id: true },
  })
  if (!link) {
    throw createError({ statusCode: 404, statusMessage: 'Связка hh.ru не найдена' })
  }

  // Замена транзакцией: удаляем все mappings и вставляем новые
  await db.transaction(async (tx) => {
    await tx.delete(hhStageMapping).where(and(
      eq(hhStageMapping.hhVacancyLinkId, id),
      eq(hhStageMapping.organizationId, orgId),
    ))
    if (body.mappings.length > 0) {
      await tx.insert(hhStageMapping).values(body.mappings.map(m => ({
        organizationId: orgId,
        hhVacancyLinkId: id,
        pipelineStageId: m.pipelineStageId,
        hhCollection: m.hhCollection,
        messageTemplate: m.messageTemplate ?? null,
      })))
    }
  })

  return { id, count: body.mappings.length }
})
