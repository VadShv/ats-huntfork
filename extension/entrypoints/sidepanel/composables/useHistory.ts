/**
 * useHistory — журнал действий рекрутера.
 *
 * Логирует все ключевые действия: захват, импорт, сводку, верификацию,
 * добавление в очередь, отправку аутрича, парсинг Telegram, заметки.
 * Хранится в chrome.storage.local (ключ hf:history), лимит 500 записей (FIFO).
 */
import { ref, onMounted } from 'vue'

export type ActionType =
  | 'capture'
  | 'import'
  | 'summary'
  | 'verify'
  | 'queue_add'
  | 'outreach_send'
  | 'telegram_parse'
  | 'note_save'
  | 'settings_change'
  | 'telegram_connect'

export interface ActionLog {
  id: string
  timestamp: number
  type: ActionType
  description: string
  candidateName?: string
  url?: string
  meta?: Record<string, unknown>
}

const STORAGE_KEY = 'hf:history'
const MAX_RECORDS = 500

const history = ref<ActionLog[]>([])
let loaded = false

export function useHistory() {
  async function load() {
    if (loaded) return
    loaded = true
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY)
      const stored = result[STORAGE_KEY]
      if (Array.isArray(stored)) history.value = stored
    } catch {
      // storage может быть недоступен
    }
  }

  function persist() {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: history.value })
    } catch {
      // ignore
    }
  }

  onMounted(() => {
    load()
  })

  /** Добавить запись в журнал. */
  function log(entry: Omit<ActionLog, 'id' | 'timestamp'>) {
    const record: ActionLog = {
      ...entry,
      id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    }
    history.value = [record, ...history.value].slice(0, MAX_RECORDS)
    persist()
    return record
  }

  /** Получить историю с фильтрацией. */
  function getHistory(filters?: {
    type?: ActionType
    since?: number
    limit?: number
  }): ActionLog[] {
    let result = history.value
    if (filters?.type) result = result.filter((h) => h.type === filters.type)
    if (filters?.since) result = result.filter((h) => h.timestamp >= filters.since!)
    if (filters?.limit) result = result.slice(0, filters.limit)
    return result
  }

  /** Очистить всю историю. */
  function clearHistory() {
    history.value = []
    persist()
  }

  /** Статистика за период. */
  function getStats(since: number): Record<string, number> {
    const filtered = history.value.filter((h) => h.timestamp >= since)
    const stats: Record<string, number> = {}
    for (const h of filtered) {
      stats[h.type] = (stats[h.type] ?? 0) + 1
    }
    return stats
  }

  /** Действия за конкретный день (от полуночи до полуночи). */
  function getByDay(dayTimestamp: number): ActionLog[] {
    const start = new Date(dayTimestamp)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return history.value.filter(
      (h) => h.timestamp >= start.getTime() && h.timestamp < end.getTime()
    )
  }

  /** Дни с активностью в текущем месяце. */
  function getActiveDays(monthDate: Date): number[] {
    const year = monthDate.getFullYear()
    const month = monthDate.getMonth()
    const days = new Set<number>()
    for (const h of history.value) {
      const d = new Date(h.timestamp)
      if (d.getFullYear() === year && d.getMonth() === month) {
        days.add(d.getDate())
      }
    }
    return [...days].sort((a, b) => a - b)
  }

  /** Последние N действий. */
  function recent(limit = 10): ActionLog[] {
    return history.value.slice(0, limit)
  }

  return {
    history,
    log,
    getHistory,
    clearHistory,
    getStats,
    getByDay,
    getActiveDays,
    recent,
    load,
  }
}
