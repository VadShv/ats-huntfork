import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidate } from '../../database/schema'
import { findFuzzyDuplicatesForCandidate, upsertDuplicateCandidate } from '../../utils/fuzzy/match'

const bodySchema = z.object({
  scopeToActiveOrg: z.boolean().default(true),
  /** Если true, ищет дубли по всей группе (через organization.group_id). */
  includeOtherOrgs: z.boolean().default(true),
  /** Минимальный скор. По умолчанию = FUZZY_REVIEW_THRESHOLD (85). */
  threshold: z.number().int().min(60).max(100).optional(),
  /** Лимит обрабатываемых кандидатов (для smoke-теста). */
  limit: z.number().int().positive().max(10000).optional(),
  dryRun: z.boolean().default(false),
})

/**
 * POST /api/dedup/backfill-fuzzy
 *
 * Идемпотентный бэкфил fuzzy-дублей: для каждого кандидата организации
 * запускает findFuzzyDuplicatesForCandidate и upsert-ит пары в очередь.
 *
 * Безопасно вызывать повторно — пары канонизируются, существующие pending обновляются,
 * dismissed/merged не трогаются.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, bodySchema.parse)

  // Берём активных кандидатов организации
  const baseQuery = db
    .select({ id: candidate.id })
    .from(candidate)
    .where(body.scopeToActiveOrg
      ? eq(candidate.organizationId, orgId)
      : eq(candidate.mergeStatus, 'active'),
    )

  const rows = body.limit ? await baseQuery.limit(body.limit) : await baseQuery

  let processed = 0
  let pairsCreated = 0
  let pairsUpdated = 0
  const errors: Array<{ candidateId: string; message: string }> = []
  let topScore = 0

  for (const r of rows) {
    if (body.dryRun) {
      processed += 1
      continue
    }
    try {
      const matches = await findFuzzyDuplicatesForCandidate(r.id, {
        includeOtherOrgs: body.includeOtherOrgs,
        threshold: body.threshold,
      })
      for (const m of matches) {
        if (m.score > topScore) topScore = m.score
        const res = await upsertDuplicateCandidate({
          organizationId: orgId,
          candidateIdA: r.id,
          candidateIdB: m.candidateId,
          score: m.score,
          signals: m.signals,
        })
        if (res.isNew) pairsCreated += 1
        else pairsUpdated += 1
      }
      processed += 1
    }
    catch (err) {
      errors.push({ candidateId: r.id, message: (err as Error).message })
    }
  }

  return {
    ok: true,
    dryRun: body.dryRun,
    candidates: { total: rows.length, processed },
    pairs: { created: pairsCreated, updated: pairsUpdated, topScore },
    errors: errors.slice(0, 20),
    errorsCount: errors.length,
  }
})
