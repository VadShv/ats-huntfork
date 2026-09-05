import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { gamificationTeam, gamificationTeamMember } from '../../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })
const bodySchema = z.object({ userId: z.string().min(1) })

/**
 * POST /api/teams/:id/members — assign a recruiter to a team (owner/admin).
 * A recruiter belongs to at most one team per org (moves on re-assign).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const { id: teamId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { userId } = await readValidatedBody(event, bodySchema.parse)

  const team = await db.query.gamificationTeam.findFirst({
    where: and(eq(gamificationTeam.id, teamId), eq(gamificationTeam.organizationId, orgId)),
  })
  if (!team) throw createError({ statusCode: 404, statusMessage: 'Команда не найдена' })

  // Move: remove any existing membership in this org, then add.
  await db.delete(gamificationTeamMember)
    .where(and(eq(gamificationTeamMember.organizationId, orgId), eq(gamificationTeamMember.userId, userId)))
  await db.insert(gamificationTeamMember).values({ organizationId: orgId, teamId, userId })

  return { success: true }
})
