import { z } from 'zod'
import { mergeCandidates, type MergeResult } from '../../../utils/dedup/merge'

/**
 * Sprint 5.1 (P5.3): batch-merge N кандидатов в одного primary.
 *
 * POST /api/candidates/:id/merge-batch
 * Body: { mergedCandidateIds: string[] (1..10), reason?: string }
 *
 * Последовательно сливает каждого merged-кандидата в primary (тот, чей :id в URL).
 * Каждое слияние = своя транзакция + отдельная запись в candidate_merge_log,
 * что позволяет откатывать слияния по отдельности через UI журнала.
 *
 * Гарантии:
 * - primary не может фигурировать в mergedCandidateIds
 * - дубликаты mergedCandidateIds отбрасываются
 * - при ошибке на i-том кандидате — предыдущие 0..i-1 остаются слитыми,
 *   возвращается details с ok/error для каждого; HTTP 200 при partial success
 *   (фронт сам решит как реагировать)
 */
const bodySchema = z.object({
  mergedCandidateIds: z.array(z.string().min(1)).min(1).max(10),
  reason: z.string().max(500).optional(),
})

export interface BatchMergeItemResult {
  mergedCandidateId: string
  ok: boolean
  mergeLogId?: string
  transferred?: MergeResult['transferred']
  error?: string
}

export interface BatchMergeResponse {
  ok: boolean
  primaryCandidateId: string
  totalRequested: number
  totalMerged: number
  totalFailed: number
  details: BatchMergeItemResult[]
}

export default defineEventHandler(async (event): Promise<BatchMergeResponse> => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const primaryCandidateId = getRouterParam(event, 'id')
  if (!primaryCandidateId) throw createError({ statusCode: 400, statusMessage: 'primary id обязателен' })

  const body = await readValidatedBody(event, bodySchema.parse)

  // Дедуп + защита от само-слияния
  const uniqueIds = Array.from(new Set(body.mergedCandidateIds)).filter(id => id !== primaryCandidateId)
  if (uniqueIds.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Список mergedCandidateIds пуст после удаления primary и дубликатов',
    })
  }

  const details: BatchMergeItemResult[] = []
  let totalMerged = 0
  let totalFailed = 0

  for (const mergedCandidateId of uniqueIds) {
    try {
      const res = await mergeCandidates({
        primaryCandidateId,
        mergedCandidateId,
        userId: session.session.userId,
        pairId: null,
        reason: body.reason ?? null,
        signals: [{ kind: 'batch', value: `merged-into-${primaryCandidateId}` }],
        score: null,
        mergeKind: 'manual',
      })
      details.push({
        mergedCandidateId,
        ok: true,
        mergeLogId: res.mergeLogId,
        transferred: res.transferred,
      })
      totalMerged++
    }
    catch (err: any) {
      details.push({
        mergedCandidateId,
        ok: false,
        error: err?.statusMessage || err?.message || 'unknown error',
      })
      totalFailed++
    }
  }

  return {
    ok: totalFailed === 0,
    primaryCandidateId,
    totalRequested: uniqueIds.length,
    totalMerged,
    totalFailed,
    details,
  }
})
