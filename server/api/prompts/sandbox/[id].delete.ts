import { and, eq } from 'drizzle-orm'
import { promptSandbox } from '../../../database/schema'
import { requirePermission } from '../../../utils/requirePermission'

/**
 * DELETE /api/prompts/sandbox/:id
 * Delete a sandbox prompt. Only the owner can delete.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { scoring: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Не указан id' })

  const existing = await db.query.promptSandbox.findFirst({
    where: and(
      eq(promptSandbox.id, id),
      eq(promptSandbox.organizationId, orgId),
    ),
  })

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Промпт не найден' })
  if (existing.userId !== userId) {
    throw createError({ statusCode: 403, statusMessage: 'Только владелец может удалить промпт' })
  }

  await db.delete(promptSandbox).where(eq(promptSandbox.id, id))

  return { success: true }
})
