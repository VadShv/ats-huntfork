import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidateDuplicateCandidate } from '../../../../database/schema'
import { mergeCandidates } from '../../../../utils/dedup/merge'

const bodySchema = z.object({
  /** Какой из двух кандидатов остаётся как primary (id обязателен). */
  primaryCandidateId: z.string().min(1),
  reason: z.string().max(500).optional(),
})

/**
 * POST /api/dedup/duplicates/:pairId/merge
 *
 * Сливает пару из fuzzy-очереди. Тело: { primaryCandidateId, reason? }.
 * primaryCandidateId должен быть одним из candidateIdA / candidateIdB у пары.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const pairId = getRouterParam(event, 'pairId')
  if (!pairId) throw createError({ statusCode: 400, statusMessage: 'pairId обязателен' })

  const body = await readValidatedBody(event, bodySchema.parse)

  // Найдём пару
  const [pair] = await db.select().from(candidateDuplicateCandidate)
    .where(eq(candidateDuplicateCandidate.id, pairId))
    .limit(1)
  if (!pair) throw createError({ statusCode: 404, statusMessage: 'Пара не найдена' })
  if (pair.status !== 'pending') {
    throw createError({ statusCode: 400, statusMessage: `Пара уже обработана (status=${pair.status})` })
  }

  // primaryCandidateId должен быть один из A/B
  if (body.primaryCandidateId !== pair.candidateIdA && body.primaryCandidateId !== pair.candidateIdB) {
    throw createError({ statusCode: 400, statusMessage: 'primaryCandidateId не принадлежит этой паре' })
  }
  const mergedCandidateId = body.primaryCandidateId === pair.candidateIdA
    ? pair.candidateIdB
    : pair.candidateIdA

  // Преобразуем signals из { name: 92, city: 100 } в массив { kind, value, score } для merge_log
  const signalsArr = Object.entries(pair.signals ?? {}).map(([k, v]) => ({
    kind: k,
    value: String(v),
    score: typeof v === 'number' ? v : undefined,
  }))

  const result = await mergeCandidates({
    primaryCandidateId: body.primaryCandidateId,
    mergedCandidateId,
    userId: session.session.userId,
    pairId,
    reason: body.reason ?? null,
    signals: signalsArr,
    score: pair.score,
    mergeKind: 'manual',
  })

  return result
})
