/**
 * POST /api/dedup/ai-arbitrate-batch
 *
 * Sprint 5.2 (P5.2): массовый AI-арбитраж pending-пар без вердикта.
 *
 * Поведение по умолчанию: берёт первые N (по умолчанию 20) pending-пар
 * со score в диапазоне [85..94] (зона неопределённости — между
 * FUZZY_REVIEW=85 и FUZZY_AUTOMERGE=95) и арбитрирует их одну за другой.
 *
 * Запросы к LLM выполняются последовательно (concurrency=1), чтобы не
 * упереться в лимиты провайдера. Каждый успех/неуспех попадает в
 * details[].
 *
 * Body:
 *   limit?: number (1..50, default 20)
 *   minScore?: number (default 85)
 *   maxScore?: number (default 94)
 */
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { candidate, candidateDuplicateCandidate } from '../../database/schema'
import { arbitrateDuplicatePair } from '../../utils/dedup/ai-arbiter'

const bodySchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(20),
  minScore: z.number().int().min(0).max(100).optional().default(85),
  maxScore: z.number().int().min(0).max(100).optional().default(94),
}).optional()

interface BatchArbitrateResponse {
  ok: boolean
  totalRequested: number
  totalArbitrated: number
  totalFailed: number
  details: Array<{
    pairId: string
    ok: boolean
    verdict?: 'same' | 'different' | 'unsure'
    confidence?: number
    error?: string
  }>
}

export default defineEventHandler(async (event): Promise<BatchArbitrateResponse> => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, b => (b ? bodySchema.parse(b) : undefined))
  const limit = body?.limit ?? 20
  const minScore = body?.minScore ?? 85
  const maxScore = body?.maxScore ?? 94

  // Выбираем pending pairs где AI ещё не выдал вердикт.
  // Cross-org пары не арбитрируем: фильтруем по candidateA.organizationId,
  // т.к. fuzzy-pipeline кладёт «свою» сторону в A.
  const pairs = await db
    .select({
      pairId: candidateDuplicateCandidate.id,
      score: candidateDuplicateCandidate.score,
    })
    .from(candidateDuplicateCandidate)
    .innerJoin(candidate, eq(candidate.id, candidateDuplicateCandidate.candidateIdA))
    .where(and(
      eq(candidateDuplicateCandidate.status, 'pending'),
      isNull(candidateDuplicateCandidate.aiVerdict),
      gte(candidateDuplicateCandidate.score, minScore),
      lte(candidateDuplicateCandidate.score, maxScore),
      eq(candidate.organizationId, orgId),
    ))
    .orderBy(asc(candidateDuplicateCandidate.score))
    .limit(limit)

  if (pairs.length === 0) {
    return {
      ok: true,
      totalRequested: 0,
      totalArbitrated: 0,
      totalFailed: 0,
      details: [],
    }
  }

  const details: BatchArbitrateResponse['details'] = []
  let totalArbitrated = 0
  let totalFailed = 0

  // Последовательно (concurrency=1), чтобы не упереться в rate limits.
  for (const p of pairs) {
    try {
      const r = await arbitrateDuplicatePair({ orgId, pairId: p.pairId, force: false })
      details.push({
        pairId: p.pairId,
        ok: true,
        verdict: r.verdict,
        confidence: r.confidence,
      })
      totalArbitrated++
    }
    catch (err: any) {
      const msg = err?.statusMessage || err?.message || 'Неизвестная ошибка'
      details.push({ pairId: p.pairId, ok: false, error: msg })
      totalFailed++
    }
  }

  return {
    ok: totalFailed === 0,
    totalRequested: pairs.length,
    totalArbitrated,
    totalFailed,
    details,
  }
})
