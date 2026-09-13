import { z } from 'zod'
import { requireApplicationInScope } from '../../../../utils/access/scope'
import { and, eq } from 'drizzle-orm'
import { application, applicationComment, commentPoll } from '../../../../database/schema/app'
import { renderMarkdown } from '../../../../utils/comments/sanitize'
import { notifyThreadChanged } from '../../../../utils/comments/threadBus'

/**
 * POST /api/applications/:id/polls
 * Create a decision poll. Creates a comment + poll record.
 */
const createPollSchema = z.object({
  question: z.string().min(1).max(500),
  options: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    emoji: z.string().min(1),
  })).min(2).max(6).default([
    { key: 'yes', label: 'Нанимать', emoji: '👍' },
    { key: 'no', label: 'Отклонить', emoji: '👎' },
    { key: 'maybe', label: 'Под вопросом', emoji: '🤔' },
  ]),
  isInternal: z.boolean().default(false),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const id = getRouterParam(event, 'id')!
  await requireApplicationInScope(event, id as string, orgId as string)
  const body = await readValidatedBody(event, createPollSchema.parse)

  // Get candidateId from application (scoped to org)
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { candidateId: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  // Create comment with question
  const bodyHtml = renderMarkdown(body.question)
  const [comment] = await db.insert(applicationComment).values({
    organizationId: orgId,
    applicationId: id,
    candidateId: app.candidateId,
    authorUserId: userId,
    body: body.question,
    bodyHtml,
    isInternal: body.isInternal,
    kind: 'text',
  }).returning()

  // Create poll
  const [poll] = await db.insert(commentPoll).values({
    commentId: comment.id,
    question: body.question,
    options: body.options,
  }).returning()

  notifyThreadChanged(id)

  return { comment, poll }
})
