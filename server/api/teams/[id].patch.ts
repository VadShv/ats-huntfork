import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { gamificationTeam } from '../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })
const bodySchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isArchived: z.boolean().optional(),
})

/** PATCH /api/teams/:id — rename / recolor / archive (owner/admin). */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  const set: Record<string, unknown> = {}
  if (body.name !== undefined) set.name = body.name
  if (body.color !== undefined) set.color = body.color
  if (body.isArchived !== undefined) set.isArchived = body.isArchived

  const [row] = await db.update(gamificationTeam).set(set)
    .where(and(eq(gamificationTeam.id, id), eq(gamificationTeam.organizationId, orgId)))
    .returning()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Команда не найдена' })
  return { id: row.id, name: row.name, color: row.color, isArchived: row.isArchived }
})
