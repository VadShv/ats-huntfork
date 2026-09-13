import { and, eq } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../../utils/access/scope'
import { z } from 'zod'
import { commentPoll, commentPollVote, applicationComment, application } from '../../../../../database/schema/app'
import { notifyThreadChanged } from '../../../../../utils/comments/threadBus'

/**
 * POST /api/applications/:id/polls/:pollId/vote
 * Cast or change a vote on a poll.
 */
const voteSchema = z.object({
  optionKey: z.string().min(1).max(50),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const pollId = getRouterParam(event, 'pollId')!
  const id = getRouterParam(event, 'id')!
  await requireApplicationInScope(event, id as string, orgId as string)
  const body = await readValidatedBody(event, voteSchema.parse)

  // Verify poll belongs to this application + org (via comment → application chain)
  const poll = await db.query.commentPoll.findFirst({
    where: eq(commentPoll.id, pollId),
    with: {
      comment: true,
    },
  })
  if (!poll) throw createError({ statusCode: 404, statusMessage: 'Опрос не найден' })

  // Verify the comment's application matches the route param and org
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  // Verify the optionKey is valid for this poll
  const validOption = poll.options.find(o => o.key === body.optionKey)
  if (!validOption) throw createError({ statusCode: 400, statusMessage: 'Недопустимый вариант ответа' })

  // Upsert vote
  await db.insert(commentPollVote)
    .values({ pollId, userId, optionKey: body.optionKey })
    .onConflictDoUpdate({
      target: [commentPollVote.pollId, commentPollVote.userId],
      set: { optionKey: body.optionKey, votedAt: new Date() },
    })

  notifyThreadChanged(id)

  return { ok: true }
})
