/**
 * DELETE /api/sourcing-searches/:id
 *
 * Архивирует сохранённый сорсинг-запрос (soft-delete: isArchived = true).
 * Это останавливает автозапуски, но кандидаты остаются для аудита.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hhSavedSearch } from '../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  const result = await db
    .update(hhSavedSearch)
    .set({
      isArchived: true,
      autoRunEnabled: false,
      nextRunAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(hhSavedSearch.id, id), eq(hhSavedSearch.organizationId, orgId)))
    .returning({ id: hhSavedSearch.id })

  if (result.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Поиск не найден' })
  }

  return { id, archived: true }
})
