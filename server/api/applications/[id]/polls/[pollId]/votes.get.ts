import { eq } from 'drizzle-orm'
import { commentPollVote } from '../../../../../database/schema/app'
import { requireApplicationInScope } from '../../../../../utils/access/scope'

/**
 * GET /api/applications/:id/polls/:pollId/votes
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const pollId = getRouterParam(event, 'pollId')!
  await requireApplicationInScope(event, getRouterParam(event, 'id') as string, session.session.activeOrganizationId as string)

  const rows = await db
    .select({ userId: commentPollVote.userId, optionKey: commentPollVote.optionKey })
    .from(commentPollVote)
    .where(eq(commentPollVote.pollId, pollId))

  return { votes: rows }
})
