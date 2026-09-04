import { z } from 'zod'
import { claimQuest } from '../../utils/quests'

const bodySchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/quests/claim
 * Claim a completed quest → awards bonus SXP to the current HuntPass season.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id
  const { id } = await readValidatedBody(event, bodySchema.parse)

  return claimQuest(userId, orgId, id)
})
