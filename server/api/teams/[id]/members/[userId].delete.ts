import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { gamificationTeamMember } from '../../../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1), userId: z.string().min(1) })

/** DELETE /api/teams/:id/members/:userId — remove a recruiter from a team (owner/admin). */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const { id: teamId, userId } = await getValidatedRouterParams(event, paramsSchema.parse)

  await db.delete(gamificationTeamMember).where(and(
    eq(gamificationTeamMember.organizationId, orgId),
    eq(gamificationTeamMember.teamId, teamId),
    eq(gamificationTeamMember.userId, userId),
  ))
  return { success: true }
})
