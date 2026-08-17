/**
 * useSearchRun — управление прогоном X-Ray-запросов через серверный Search Gateway.
 *
 * Состояние по query ID:
 *  - idle / running / done / empty / error
 *  - результат: total, provider, fetchedAt, cached, stale
 *
 * Два режима:
 *  - runSingle: один запрос (мгновенный ответ)
 *  - runBatch: массив запросов (синхронно при ≤5, поллинг при >5)
 *
 * Все запросы идут на ${HUNTFORK_BASE}/api/extension/search-run с credentials: 'include'.
 * 401 → toast «Требуется вход на huntfork.ru».
 * Отказ сети → состояние error, toast. Карта не ломается.
 */
import { ref, reactive, computed } from 'vue'
import { useToast } from './useToast'

const HUNTFORK_BASE = 'https://huntfork.ru'

export type RunStatus = 'idle' | 'running' | 'done' | 'empty' | 'error'

export interface RunResult {
  total: number
  provider: string
  fetchedAt: number
  cached: boolean
  stale: boolean
  detectedQuery?: string
}

/** In-module состояние — живёт между монтированиями. */
const _runState = reactive<Record<string, RunStatus>>({})
const _runResult = reactive<Record<string, RunResult | null>>({})
const _batchRunning = ref(false)
const _batchTotal = ref(0)
const _batchDone = ref(0)
const _batchErrors = ref(0)
const _batchCached = ref(0)
const _batchFound = ref(0)

export function useSearchRun() {
  const { toast } = useToast()

  function runState(queryId: string): RunStatus {
    return _runState[queryId] || 'idle'
  }

  function runResult(queryId: string): RunResult | null {
    return _runResult[queryId] || null
  }

  /** Прогон одного запроса. */
  async function runSingle(
    queryId: string,
    query: string,
    engine: 'google' | 'yandex' = 'google',
    jobId?: string,
    forceRefresh = false,
  ): Promise<void> {
    _runState[queryId] = 'running'

    try {
      const resp = await fetch(`${HUNTFORK_BASE}/api/extension/search-run`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, engine, jobId, forceRefresh }),
      })

      if (resp.status === 401) {
        _runState[queryId] = 'error'
        toast('Требуется вход на huntfork.ru', 'error')
        return
      }
      if (resp.status === 429) {
        _runState[queryId] = 'error'
        toast('Слишком много запросов. Подождите минуту', 'warn')
        return
      }

      const data = await resp.json()

      if (!data.ok) {
        _runState[queryId] = 'error'
        const errCode = data.error?.code || 'provider_error'
        if (errCode !== 'no_keys') {
          toast(data.error?.message || 'Ошибка поиска', 'error')
        }
        return
      }

      const result = data.result
      _runResult[queryId] = {
        total: result.total,
        provider: result.provider,
        fetchedAt: Date.now(),
        cached: result.cached,
        stale: result.stale || false,
        detectedQuery: result.detectedQuery,
      }
      _runState[queryId] = result.total > 0 ? 'done' : 'empty'
    } catch (err) {
      _runState[queryId] = 'error'
      // Сетевая ошибка — не toast на каждый, только если не batch
      if (!_batchRunning.value) {
        toast('Не удалось связаться с сервером', 'error')
      }
    }
  }

  /** Массовый прогон. */
  async function runBatch(
    queries: Array<{ id: string; query: string; engine: 'google' | 'yandex' }>,
    jobId: string,
  ): Promise<void> {
    _batchRunning.value = true
    _batchTotal.value = queries.length
    _batchDone.value = 0
    _batchErrors.value = 0
    _batchCached.value = 0
    _batchFound.value = 0

    try {
      const resp = await fetch(`${HUNTFORK_BASE}/api/extension/search-batch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries, jobId }),
      })

      if (resp.status === 401) {
        toast('Требуется вход на huntfork.ru', 'error')
        _batchRunning.value = false
        return
      }

      const data = await resp.json()

      if (!data.ok) {
        toast('Ошибка массового прогона', 'error')
        _batchRunning.value = false
        return
      }

      if (data.mode === 'sync') {
        // Синхронный режим — результаты уже готовы
        for (const [qid, outcome] of Object.entries(data.results)) {
          applyOutcome(qid, outcome as any)
        }
        _batchRunning.value = false
      } else {
        // Асинхронный режим — опрашиваем
        await pollBatch(data.batchId, jobId)
      }
    } catch {
      toast('Не удалось запустить прогон', 'error')
      _batchRunning.value = false
    }
  }

  /** Опрос статуса асинхронного батча. */
  async function pollBatch(batchId: string, _jobId: string): Promise<void> {
    const maxAttempts = 60 // 60 × 2с = 2 минуты максимум
    const interval = 2000

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(interval)

      try {
        const resp = await fetch(`${HUNTFORK_BASE}/api/extension/search-batch/${batchId}`, {
          credentials: 'include',
        })

        if (!resp.ok) continue

        const data = await resp.json()

        // Применяем новые результаты
        for (const [qid, outcome] of Object.entries(data.results)) {
          if (!_runResult[qid]) {
            applyOutcome(qid, outcome as any)
          }
        }

        _batchDone.value = data.done
        _batchFound.value = Object.values(_runResult).reduce(
          (s, r) => s + (r?.total || 0), 0,
        )
        _batchCached.value = Object.values(_runResult).filter(r => r?.cached).length

        if (data.status === 'complete' || data.status === 'error') {
          _batchRunning.value = false
          if (data.status === 'error') {
            toast('Прогон завершён с ошибками', 'warn')
          }
          return
        }
      } catch {
        // Сетевая ошибка опроса — продолжаем
      }
    }

    // Таймаут опроса
    _batchRunning.value = false
    toast('Прогон занимает слишком долго', 'warn')
  }

  /** Применяет результат к состоянию. */
  function applyOutcome(queryId: string, outcome: any): void {
    if (outcome && typeof outcome.total === 'number') {
      _runResult[queryId] = {
        total: outcome.total,
        provider: outcome.provider,
        fetchedAt: Date.now(),
        cached: outcome.cached || false,
        stale: outcome.stale || false,
        detectedQuery: outcome.detectedQuery,
      }
      _runState[queryId] = outcome.total > 0 ? 'done' : 'empty'
    } else if (outcome && outcome.code) {
      _runState[queryId] = 'error'
      _batchErrors.value++
    }
  }

  /** Принудительное обновление одного запроса. */
  async function refreshQuery(
    queryId: string,
    query: string,
    engine: 'google' | 'yandex' = 'google',
    jobId?: string,
  ): Promise<void> {
    return runSingle(queryId, query, engine, jobId, true)
  }

  /** Сброс состояния одного запроса. */
  function resetQuery(queryId: string): void {
    delete _runState[queryId]
    delete _runResult[queryId]
  }

  const batchProgress = computed(() => ({
    total: _batchTotal.value,
    done: _batchDone.value,
    running: _batchRunning.value ? _batchTotal.value - _batchDone.value : 0,
    errors: _batchErrors.value,
    cached: _batchCached.value,
    found: _batchFound.value,
    isActive: _batchRunning.value,
  }))

  return {
    runState,
    runResult,
    runSingle,
    runBatch,
    refreshQuery,
    resetQuery,
    batchProgress,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
