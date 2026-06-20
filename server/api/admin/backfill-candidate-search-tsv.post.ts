import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { candidate } from '../../database/schema'
import { buildCandidateSearchText } from '../../utils/candidateSearchText'
import { db } from '../../utils/db'

const bodySchema = z.object({
  /** Чанк за один проход. По умолчанию 200 — компромисс между скоростью и пиковой памятью. */
  batchSize: z.number().int().min(1).max(2000).default(200),
  /**
   * Если true — перезаписать tsvector у всех кандидатов организации, даже у тех,
   * у кого он уже заполнен. По умолчанию false — заполняем только пустые.
   */
  forceReindex: z.boolean().default(false),
  /** Не писать в БД (только посчитать). */
  dryRun: z.boolean().default(false),
})

/**
 * POST /api/admin/backfill-candidate-search-tsv
 *
 * Идемпотентный бэкфил полнотекстового индекса для search_candidates (Sprint 11).
 * Проходит кандидатов активной организации, собирает текст из всех резюме и
 * пишет в candidate.search_tsv через to_tsvector('simple', …).
 *
 * Можно запускать многократно — без forceReindex затронет только новых.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, bodySchema.parse)

  // Берём id-шники одной выборкой — экономим память.
  const whereExpr = body.forceReindex
    ? eq(candidate.organizationId, orgId)
    : and(
        eq(candidate.organizationId, orgId),
        // ts_vector IS NULL — берём только незаиндексированных
        sql`"search_tsv" IS NULL`,
      )

  const rows = await db.select({ id: candidate.id })
    .from(candidate)
    .where(whereExpr)

  let processed = 0
  let updated = 0
  let failed = 0

  // Чанками — чтобы и tx не лежали часами, и логи были живые.
  for (let i = 0; i < rows.length; i += body.batchSize) {
    const chunk = rows.slice(i, i + body.batchSize)
    for (const r of chunk) {
      processed++
      try {
        const text = await buildCandidateSearchText({ orgId, candidateId: r.id })
        if (!body.dryRun) {
          await db.execute(sql`
            UPDATE "candidate"
               SET "search_tsv" = to_tsvector('simple', ${text})
             WHERE "organization_id" = ${orgId}
               AND "id" = ${r.id}
          `)
        }
        updated++
      }
      catch (err) {
        failed++
        console.error('[backfill-candidate-search-tsv] failed', r.id, err)
      }
    }
  }

  return {
    orgId,
    total: rows.length,
    processed,
    updated,
    failed,
    forceReindex: body.forceReindex,
    dryRun: body.dryRun,
  }
})

