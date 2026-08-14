/**
 * Спринт 19.5: внутрипроцессная шина «непрочитанные изменились» для SSE.
 *
 * Приложение работает в одном процессе (Nitro + pg-boss воркеры вместе),
 * поэтому простого реестра подписчиков в памяти достаточно. При переходе
 * на несколько инстансов заменить на PG LISTEN/NOTIFY.
 */
type Listener = () => void

const listeners = new Map<string, Set<Listener>>()

/** Подписка на изменения непрочитанных организации. Возвращает отписку. */
export function subscribeUnread(orgId: string, fn: Listener): () => void {
  let set = listeners.get(orgId)
  if (!set) {
    set = new Set()
    listeners.set(orgId, set)
  }
  set.add(fn)
  return () => {
    const s = listeners.get(orgId)
    if (!s) return
    s.delete(fn)
    if (s.size === 0) listeners.delete(orgId)
  }
}

/** Дёрнуть всех подписчиков организации (best-effort, ошибки глотаем). */
export function notifyUnreadChanged(orgId: string): void {
  const set = listeners.get(orgId)
  if (!set) return
  for (const fn of set) {
    try {
      fn()
    }
    catch {
      // подписчик умер — отписка произойдёт при закрытии соединения
    }
  }
}
