/**
 * Shared validation helpers for pipeline stage rules.
 * Used by POST, PATCH and stage PATCH endpoints.
 */

interface StageInput {
  name: string
  type: string
  isTerminal: boolean
  isArchived?: boolean
}

/**
 * Validates a set of pipeline stages against the business rules.
 * Only non-archived stages are considered for the structural constraints.
 *
 * Throws createError({ statusCode: 400 }) with a Russian message on failure.
 */
export function validatePipelineStages(stages: StageInput[]): void {
  const active = stages.filter((s) => !s.isArchived)

  // ── ≥2 active stages ──────────────────────────────────────────────
  if (active.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Воронка должна содержать минимум 2 активных этапа',
    })
  }

  // ── At least one success-terminal (hired + isTerminal) ────────────
  const hasSuccessTerminal = active.some(
    (s) => s.type === 'hired' && s.isTerminal,
  )
  if (!hasSuccessTerminal) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Воронка должна содержать как минимум один финальный этап успеха (тип «Принят»)',
    })
  }

  // ── At least one reject-terminal (rejected + isTerminal) ──────────
  const hasRejectTerminal = active.some(
    (s) => s.type === 'rejected' && s.isTerminal,
  )
  if (!hasRejectTerminal) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Воронка должна содержать как минимум один финальный этап отказа (тип «Отказ»)',
    })
  }

  // ── Unique stage names within active set (case-insensitive) ───────
  const seen = new Set<string>()
  for (const s of active) {
    const key = s.name.trim().toLowerCase()
    if (seen.has(key)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Названия этапов должны быть уникальны в пределах воронки',
      })
    }
    seen.add(key)
  }
}
