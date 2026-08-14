/**
 * PATCH /api/hh-vacancy-links/:id
 *
 * Обновить настройки связки вакансии с hh.ru.
 * Body: { pushSyncEnabled?: boolean, autoSyncEnabled?: boolean }
 *
 * Спринт 12.2:
 *   — pushSyncEnabled: пушить ли смену этапа в системе обратно на hh.ru
 *   — autoSyncEnabled: pull-синхронизация откликов с hh.ru
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hhVacancyLink } from '../../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })

const bodySchema = z.object({
  pushSyncEnabled: z.boolean().optional(),
  autoSyncEnabled: z.boolean().optional(),
}).strict().refine(
  b => b.pushSyncEnabled !== undefined || b.autoSyncEnabled !== undefined,
  { message: 'Нужно передать хотя бы одно поле' },
)

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

  const patch: Partial<{ pushSyncEnabled: boolean, autoSyncEnabled: boolean, updatedAt: Date }> = {
    updatedAt: new Date(),
  }
  if (body.pushSyncEnabled !== undefined) patch.pushSyncEnabled = body.pushSyncEnabled
  if (body.autoSyncEnabled !== undefined) patch.autoSyncEnabled = body.autoSyncEnabled

  const [updated] = await db
    .update(hhVacancyLink)
    .set(patch)
    .where(and(eq(hhVacancyLink.id, id), eq(hhVacancyLink.organizationId, orgId)))
    .returning({
      id: hhVacancyLink.id,
      pushSyncEnabled: hhVacancyLink.pushSyncEnabled,
      autoSyncEnabled: hhVacancyLink.autoSyncEnabled,
    })

  return { ok: true as const, link: updated }
})
