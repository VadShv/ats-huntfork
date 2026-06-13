/**
 * PATCH /api/sourcing-searches/:id
 *
 * Обновить параметры сохранённого сорсинг-запроса hh.ru.
 * Можно править: name, query, scheduleMinutes, autoRunEnabled,
 * maxPagesPerRun.
 *
 * При смене расписания пересчитываем nextRunAt.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hhSavedSearch } from '../../database/schema'
import { sourcingQuerySchema } from '../../utils/hh/sourcing/query'

const paramsSchema = z.object({ id: z.string().min(1) })

const bodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    query: sourcingQuerySchema.optional(),
    scheduleMinutes: z.number().int().min(60).max(43_200).nullable().optional(),
    autoRunEnabled: z.boolean().optional(),
    maxPagesPerRun: z.number().int().min(1).max(40).optional(),
    maxCandidates: z.number().int().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Нечего обновлять' })

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  // Проверяем владение
  const existing = await db.query.hhSavedSearch.findFirst({
    where: and(eq(hhSavedSearch.id, id), eq(hhSavedSearch.organizationId, orgId)),
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Поиск не найден' })
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) updates.name = body.name
  if (body.query !== undefined) updates.query = body.query
  if (body.scheduleMinutes !== undefined) updates.scheduleMinutes = body.scheduleMinutes
  if (body.autoRunEnabled !== undefined) updates.autoRunEnabled = body.autoRunEnabled
  if (body.maxPagesPerRun !== undefined) updates.maxPagesPerRun = body.maxPagesPerRun
  if (body.maxCandidates !== undefined) updates.maxCandidates = body.maxCandidates

  // Если меняем расписание/автозапуск — пересчёт nextRunAt
  const willAuto = body.autoRunEnabled ?? existing.autoRunEnabled
  const willSchedule = body.scheduleMinutes === undefined ? existing.scheduleMinutes : body.scheduleMinutes
  if (body.autoRunEnabled !== undefined || body.scheduleMinutes !== undefined) {
    if (willAuto && willSchedule !== null) {
      // Если расписание поменялось — переставляем от последнего запуска (или сейчас)
      const base = existing.lastRunAt?.getTime() ?? Date.now()
      updates.nextRunAt = new Date(base + willSchedule * 60_000)
    } else {
      updates.nextRunAt = null
    }
  }

  await db
    .update(hhSavedSearch)
    .set(updates)
    .where(and(eq(hhSavedSearch.id, id), eq(hhSavedSearch.organizationId, orgId)))

  return { id, updated: true }
})
