import { z } from 'zod'
import { mergeCandidates } from '../../../utils/dedup/merge'

const bodySchema = z.object({
  /** id кандидата, который будет слит в текущего (текущий = primary). */
  mergedCandidateId: z.string().min(1),
  reason: z.string().max(500).optional(),
})

/**
 * POST /api/candidates/:id/merge
 *
 * Ручное слияние: текущий кандидат (path id) — primary,
 * mergedCandidateId — тот, кого сливаем. Без пары из fuzzy-очереди.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const primaryId = getRouterParam(event, 'id')
  if (!primaryId) throw createError({ statusCode: 400, statusMessage: 'id обязателен' })

  const body = await readValidatedBody(event, bodySchema.parse)
  if (primaryId === body.mergedCandidateId) {
    throw createError({ statusCode: 400, statusMessage: 'Нельзя слить кандидата с самим собой' })
  }

  const result = await mergeCandidates({
    primaryCandidateId: primaryId,
    mergedCandidateId: body.mergedCandidateId,
    userId: session.session.userId,
    reason: body.reason ?? null,
    signals: [{ kind: 'manual', value: 'recruiter-initiated' }],
    score: null,
    mergeKind: 'manual',
  })

  return result
})
