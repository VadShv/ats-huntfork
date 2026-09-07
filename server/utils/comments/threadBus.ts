/**
 * Collaboration Hub (Этап 4) — внутрипроцессная шина «тред отклика изменился».
 *
 * Мгновенно оповещает SSE-подписчиков (открывших обсуждение) о новых
 * комментариях/реакциях/снимках, чтобы UI обновлялся без поллинга. Подписка —
 * по applicationId. Как и unreadBus, это реестр в памяти одного процесса
 * (Nitro + воркеры вместе). Для мультиинстанса заменить на PG LISTEN/NOTIFY.
 */
type Listener = () => void

const listeners = new Map<string, Set<Listener>>()

/** Подписка на изменения треда отклика. Возвращает функцию отписки. */
export function subscribeThread(applicationId: string, fn: Listener): () => void {
  let set = listeners.get(applicationId)
  if (!set) {
    set = new Set()
    listeners.set(applicationId, set)
  }
  set.add(fn)
  return () => {
    const s = listeners.get(applicationId)
    if (!s) return
    s.delete(fn)
    if (s.size === 0) listeners.delete(applicationId)
  }
}

/** Дёрнуть подписчиков треда (best-effort, ошибки глотаем). */
export function notifyThreadChanged(applicationId: string): void {
  const set = listeners.get(applicationId)
  if (!set) return
  for (const fn of set) {
    try {
      fn()
    }
    catch {
      // подписчик умрёт — отписка при закрытии соединения
    }
  }
}
