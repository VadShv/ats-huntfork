import {
  findFuzzyDuplicatesForCandidate,
  upsertDuplicateCandidate,
} from '../../fuzzy/match'
import { getBoss } from '../../queue/boss'

/**
 * Фоновая очередь fuzzy-детекта дублей.
 *
 * Зачем:
 *   findFuzzyDuplicatesForCandidate делает SQL-выборку + Levenshtein
 *   по 10..1000+ кандидатам внутри группы организаций. На hot-path
 *   (POST /api/candidates, hh-sync пачкой) это даёт +200..1000мс на запрос.
 *
 * Решение: ставим задачу в pg-boss, отвечаем клиенту сразу, а воркер
 * считает скоры и записывает пары в candidate_duplicate_candidate
 * (как раньше делал синхронный код).
 *
 * Очередь: dedup-fuzzy
 * Payload: { candidateId, organizationId, includeOtherOrgs }
 */

export const FUZZY_QUEUE = 'dedup-fuzzy'

export interface FuzzyJobPayload {
  candidateId: string
  organizationId: string
  includeOtherOrgs: boolean
}

/**
 * Поставить задачу. Идемпотентно по candidateId — если предыдущая
 * задача с тем же payload ещё не выполнена, pg-boss заменит её
 * (singletonKey + singletonHours).
 *
 * НЕ кидает наружу — если очередь упала, лог и продолжаем (best-effort фон).
 */
export async function enqueueFuzzyDetect(payload: FuzzyJobPayload): Promise<void> {
  try {
    const boss = await getBoss()
    await boss.send(FUZZY_QUEUE, payload, {
      retryLimit: 3,
      retryDelay: 30, // секунд
      retryBackoff: true,
      expireInSeconds: 5 * 60, // 5 мин на выполнение
      singletonKey: `fuzzy:${payload.candidateId}`,
      singletonHours: 1,
    })
    logDebug('dedup.fuzzy_enqueued', {
      candidate_id: payload.candidateId,
      organization_id: payload.organizationId,
      cross_org: payload.includeOtherOrgs,
      module: 'dedup',
    })
  }
  catch (err) {
    // Не валим основной запрос — это вторичная вычислительная задача
    logError('dedup.fuzzy_enqueue_failed', {
      candidate_id: payload.candidateId,
      error_message: err instanceof Error ? err.message : String(err),
      module: 'dedup',
    })
  }
}

/**
 * Worker — считает fuzzy-дубли и пишет пары. Регистрируется
 * один раз в Nitro plugin при старте сервера.
 */
export async function processFuzzyJob(job: { data: FuzzyJobPayload }): Promise<void> {
  const { candidateId, organizationId, includeOtherOrgs } = job.data
  const startedAt = Date.now()

  try {
    const matches = await findFuzzyDuplicatesForCandidate(candidateId, {
      includeOtherOrgs,
    })

    let upsertedNew = 0
    for (const m of matches) {
      const res = await upsertDuplicateCandidate({
        organizationId,
        candidateIdA: candidateId,
        candidateIdB: m.candidateId,
        score: m.score,
        signals: m.signals,
      })
      if (res.isNew) upsertedNew++
    }

    logInfo('dedup.fuzzy_completed', {
      candidate_id: candidateId,
      organization_id: organizationId,
      matches_total: matches.length,
      matches_new: upsertedNew,
      duration_ms: Date.now() - startedAt,
      module: 'dedup',
    })
  }
  catch (err) {
    logError('dedup.fuzzy_job_failed', {
      candidate_id: candidateId,
      organization_id: organizationId,
      error_message: err instanceof Error ? err.message : String(err),
      module: 'dedup',
    })
    throw err // pg-boss сделает retry с backoff
  }
}
