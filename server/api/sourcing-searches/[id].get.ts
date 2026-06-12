/**
 * GET /api/sourcing-searches/:id
 *
 * Возвращает один сохранённый сорсинг-запрос (для редактирования в UI).
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hhSavedSearch } from '../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  const search = await db.query.hhSavedSearch.findFirst({
    where: and(eq(hhSavedSearch.id, id), eq(hhSavedSearch.organizationId, orgId)),
  })

  if (!search) {
    throw createError({ statusCode: 404, statusMessage: 'Поиск не найден' })
  }

  return { search }
})
