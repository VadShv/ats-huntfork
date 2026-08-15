/**
 * POST /api/extension/note
 *
 * S4 Sidekick: сохранение результата саммари/карточки знаний заметкой
 * (комментарием) к кандидату. Тонкая обёртка над существующим механизмом
 * комментариев — та же таблица comment, тот же recordActivity.
 *
 * Body: { candidateId: string, body: string (1..20000) }
 * Ответ: { ok: true, commentId }
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidate, comment } from '../../database/schema'
import { createRateLimiter } from '../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: 'Слишком много заметок. Подождите немного',
})

const bodySchema = z.object({
  candidateId: z.string().uuid(),
  body: z.string().min(1).max(20_000),
})

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { comment: ['create'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  const target = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, body.candidateId), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  const noteBody = `**Заметка из расширения Huntfork Sidekick**\n\n${body.body}`

  const [created] = await db.insert(comment).values({
    organizationId: orgId,
    authorId: session.user.id,
    targetType: 'candidate',
    targetId: body.candidateId,
    body: noteBody,
  }).returning({ id: comment.id })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось сохранить заметку' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'comment_added',
    resourceType: 'candidate',
    resourceId: body.candidateId,
    metadata: { commentId: created.id, source: 'extension' },
  })

  logApiRequest(event, session, 'extension.note', { candidateId: body.candidateId })

  setResponseStatus(event, 201)
  return { ok: true, commentId: created.id }
})
