/**
 * DELETE /api/hh-vacancy-links/:id
 *
 * Отвязывает вакансию Huntfork от hh.ru — удаляет строку `hh_vacancy_link`.
 * Каскад в схеме также убирает связанные `hh_stage_mapping` и `hh_negotiation`
 * (см. onDelete: 'cascade' на ссылках).
 *
 * Существующие application'ы (с source='hh') НЕ удаляются — это пользовательские
 * данные, и менеджер может продолжать с ними работать после отвязки.
 *
 * Body: пусто.
 * Ответ: { deleted: true } или 404.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hhVacancyLink } from '../../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  const rows = await db
    .select({ id: hhVacancyLink.id })
    .from(hhVacancyLink)
    .where(and(
      eq(hhVacancyLink.id, id),
      eq(hhVacancyLink.organizationId, orgId),
    ))
    .limit(1)

  if (rows.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Связка не найдена' })
  }

  await db.delete(hhVacancyLink).where(eq(hhVacancyLink.id, id))

  return { deleted: true as const }
})
