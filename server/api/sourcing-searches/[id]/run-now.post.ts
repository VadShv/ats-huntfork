/**
 * POST /api/sourcing-searches/:id/run-now
 *
 * Ручной триггер сорсинг-запроса. Помечает nextRunAt = сейчас,
 * чтобы фоновый воркер (S3) подхватил его на следующем тике.
 *
 * Сама работа выполняется в server/utils/hh/sourcing/runner.ts (S3).
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hhSavedSearch } from '../../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  const existing = await db.query.hhSavedSearch.findFirst({
    where: and(eq(hhSavedSearch.id, id), eq(hhSavedSearch.organizationId, orgId)),
    columns: { id: true, isArchived: true, lastRunStatus: true },
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Поиск не найден' })
  }
  if (existing.isArchived) {
    throw createError({ statusCode: 422, statusMessage: 'Поиск в архиве. Восстановите его сначала.' })
  }
  if (existing.lastRunStatus === 'running') {
    throw createError({ statusCode: 409, statusMessage: 'Поиск уже выполняется.' })
  }

  await db
    .update(hhSavedSearch)
    .set({ nextRunAt: new Date(), updatedAt: new Date() })
    .where(and(eq(hhSavedSearch.id, id), eq(hhSavedSearch.organizationId, orgId)))

  return { id, queued: true }
})
