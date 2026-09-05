import { z } from 'zod'
import { gamificationTeam } from '../../database/schema'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

/** POST /api/teams — create a team (owner/admin). */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const body = await readValidatedBody(event, bodySchema.parse)

  const [team] = await db.insert(gamificationTeam).values({
    organizationId: orgId, name: body.name, color: body.color ?? '#01696f',
  }).returning()

  return { id: team.id, name: team.name, color: team.color, members: [] }
})
