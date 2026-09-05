import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { gamificationTeam } from '../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })

/** DELETE /api/teams/:id — remove a team (owner/admin). Members cascade. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  const [row] = await db.delete(gamificationTeam)
    .where(and(eq(gamificationTeam.id, id), eq(gamificationTeam.organizationId, orgId)))
    .returning()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Команда не найдена' })
  return { success: true }
})
