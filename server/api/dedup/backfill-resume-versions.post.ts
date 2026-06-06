import { eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { candidate } from '../../database/schema'
import { appendResumeVersionIfChanged } from '../../utils/resume-version/append'

const bodySchema = z.object({
  scopeToActiveOrg: z.boolean().default(true),
  dryRun: z.boolean().default(false),
  /** Лимит для тестового прогона (если хочется обработать N кандидатов). */
  limit: z.number().int().positive().max(10000).optional(),
})

/**
 * POST /api/dedup/backfill-resume-versions
 *
 * Идемпотентный бэкфил: для каждого кандидата с непустым hhResumeRaw
 * создаёт v1 в candidate_resume_version. Безопасно вызывать повторно:
 * appendResumeVersionIfChanged сравнит content_hash и не создаст дубль.
 *
 * Дебаунс отключён (bypassDebounce: true), чтобы бэкфил всегда мог создать v1.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, bodySchema.parse)

  // Берём всех кандидатов с непустым hh_resume_raw
  const query = db
    .select({
      id: candidate.id,
      hhResumeRaw: candidate.hhResumeRaw,
      hhResumeFetchedAt: candidate.hhResumeFetchedAt,
    })
    .from(candidate)
    .where(body.scopeToActiveOrg
      ? eq(candidate.organizationId, orgId)
      : isNotNull(candidate.hhResumeRaw),
    )

  const rows = body.limit ? await query.limit(body.limit) : await query

  let processed = 0
  let created = 0
  let unchanged = 0
  let skippedNoSnapshot = 0
  const errors: Array<{ candidateId: string; message: string }> = []

  for (const r of rows) {
    if (!r.hhResumeRaw) {
      skippedNoSnapshot += 1
      continue
    }
    if (body.dryRun) {
      processed += 1
      continue
    }
    try {
      const result = await appendResumeVersionIfChanged({
        candidateId: r.id,
        raw: r.hhResumeRaw as Record<string, unknown>,
        source: 'hh',
        triggeredBy: 'backfill',
        bypassDebounce: true, // бэкфил всегда создаёт версию, минуя дебаунс
      })
      if (result.action === 'created') created += 1
      else if (result.action === 'unchanged') unchanged += 1
      processed += 1
    }
    catch (err) {
      errors.push({ candidateId: r.id, message: (err as Error).message })
    }
  }

  return {
    ok: true,
    dryRun: body.dryRun,
    candidates: {
      total: rows.length,
      processed,
      skippedNoSnapshot,
    },
    versions: {
      created,
      unchanged,
    },
    errors: errors.slice(0, 20),
    errorsCount: errors.length,
  }
})
