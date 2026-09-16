/**
 * useHhBulkAction — обёртка создания + опроса + отмены массовой hh.ru операции.
 *
 * POST /api/hh/bulk-actions → создаёт джобу (pg-boss worker).
 * GET  /api/hh/bulk-actions/:id → прогресс/результат (poll каждые 1.5с).
 * POST /api/hh/bulk-actions/:id/cancel → отмена.
 *
 * Переиспользуется в sticky bulk-bar (applications/index.vue) и в HhBulkMessageModal.
 */
export interface HhBulkActionRow {
  id: string
  actionType: string
  targetType: string
  itemIds: string[] | null
  params: { collection?: string, messageText?: string } | null
  status: string
  totalItems: number
  processedItems: number
  succeededItems: number
  failedItems: number
  results: Array<{ itemId: string, status: 'success' | 'failed', error?: string }> | null
  startedAt: string | null
  completedAt: string | null
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const POLL_INTERVAL_MS = 1500
const MAX_POLL_ATTEMPTS = 200 // ~5 min at 1.5s interval

export function useHhBulkAction() {
  const current = ref<HhBulkActionRow | null>(null)
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let pendingResolve: ((value: HhBulkActionRow) => void) | null = null

  const isRunning = computed(() => {
    const s = current.value?.status
    return s === 'pending' || s === 'running'
  })

  const progress = computed(() => {
    const a = current.value
    if (!a || a.totalItems === 0) return 0
    return Math.min(a.processedItems / a.totalItems, 1)
  })

  function clearPoll() {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  /**
   * Создаёт массовую операцию и опрашивает её до терминального статуса.
   * Guard против параллельных запусков — бросает, если уже выполняется.
   */
  async function runBulk(args: {
    actionType: string
    targetType: string
    itemIds: string[]
    params?: { collection?: string, messageText?: string }
  }): Promise<HhBulkActionRow> {
    if (isRunning.value) {
      throw new Error('Массовая операция уже выполняется')
    }

    clearPoll()

    const action = await $fetch<HhBulkActionRow>('/api/hh/bulk-actions', {
      method: 'POST',
      body: args,
    })
    current.value = action

    if (TERMINAL_STATUSES.has(action.status)) {
      return action
    }

    return new Promise<HhBulkActionRow>((resolve) => {
      pendingResolve = resolve
      let attempts = 0
      pollTimer = setInterval(async () => {
        attempts++
        if (attempts > MAX_POLL_ATTEMPTS) {
          clearPoll()
          resolve(current.value ?? action)
          return
        }
        try {
          const updated = await $fetch<HhBulkActionRow>(`/api/hh/bulk-actions/${action.id}`)
          current.value = updated
          if (TERMINAL_STATUSES.has(updated.status)) {
            clearPoll()
            pendingResolve = null
            resolve(updated)
          }
        } catch {
          // Транзиентная ошибка опроса — продолжаем опрашивать
        }
      }, POLL_INTERVAL_MS)
    })
  }

  /** Отменяет текущую выполняемую операцию. */
  async function cancelBulk(): Promise<void> {
    const a = current.value
    if (!a || !isRunning.value) return
    try {
      await $fetch(`/api/hh/bulk-actions/${a.id}/cancel`, { method: 'POST' })
    } catch {
      // Игнорируем ошибки отмены
    }
    clearPoll()
    if (current.value) {
      current.value = { ...current.value, status: 'cancelled' }
    }
    if (pendingResolve) {
      pendingResolve(current.value!)
      pendingResolve = null
    }
  }

  /** Сбрасывает состояние (очищает интервал и текущую операцию). */
  function reset() {
    clearPoll()
    current.value = null
  }

  onScopeDispose(() => clearPoll())

  return { runBulk, cancelBulk, reset, current, progress, isRunning }
}
