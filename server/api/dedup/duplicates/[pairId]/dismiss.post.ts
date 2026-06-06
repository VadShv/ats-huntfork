import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidateDuplicateCandidate } from '../../../../database/schema'

const bodySchema = z.object({
  reason: z.string().max(500).optional(),
}).optional()

/**
 * POST /api/dedup/duplicates/:pairId/dismiss
 *
 * Помечает пару как dismissed — рекрутер решил, что это не дубль.
 * Идемпотентно: повторный dismiss возвращает текущее состояние.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const pairId = getRouterParam(event, 'pairId')
  if (!pairId) throw createError({ statusCode: 400, statusMessage: 'pairId обязателен' })

  await readValidatedBody(event, b => (b ? bodySchema.parse(b) : undefined))

  const [pair] = await db.select().from(candidateDuplicateCandidate)
    .where(eq(candidateDuplicateCandidate.id, pairId))
    .limit(1)
  if (!pair) throw createError({ statusCode: 404, statusMessage: 'Пара не найдена' })

  if (pair.status === 'merged') {
    throw createError({ statusCode: 400, statusMessage: 'Пара уже слита — отклонить нельзя' })
  }
  if (pair.status === 'dismissed') {
    return { ok: true, alreadyDismissed: true, pairId }
  }

  await db.update(candidateDuplicateCandidate)
    .set({
      status: 'dismissed',
      decidedByUserId: session.session.userId,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(candidateDuplicateCandidate.id, pairId))

  return { ok: true, pairId, status: 'dismissed' }
})
