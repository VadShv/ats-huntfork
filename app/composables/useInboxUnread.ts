/**
 * Спринт 19.5: глобальный счётчик непрочитанных для бейджа «Входящие».
 *
 * Общее состояние (useState) + SSE-поток /api/conversations/unread-stream:
 * сервер шлёт счётчик сразу при подключении и мгновенно при каждом изменении
 * (новое входящее / прочтение диалога). EventSource переподключается сам;
 * если соединение закрыто совсем — переоткрываем через 5с.
 * Поток запускает AppTopBar (один на приложение), страница Инбокса
 * дополнительно синхронизирует значение при своих refresh.
 */
export function useInboxUnread() {
  const unread = useState<number>('inbox-unread-total', () => 0)

  /** Разовый запрос счётчика (fallback и ручная синхронизация). */
  async function refreshUnread() {
    try {
      const res = await $fetch<{ unread: number }>('/api/conversations/unread-count')
      unread.value = res.unread
    }
    catch {
      // молча: сеть/401 — бейдж просто не обновится
    }
  }

  /** Открыть SSE-поток (вызывать в onMounted одного компонента). */
  function startStream() {
    if (import.meta.server || typeof EventSource === 'undefined') return

    let es: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const connect = () => {
      if (stopped) return
      es = new EventSource('/api/conversations/unread-stream')
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as { unread?: number }
          if (typeof data.unread === 'number') unread.value = data.unread
        }
        catch {
          // мусор в потоке — игнорируем
        }
      }
      es.onerror = () => {
        // EventSource сам ретраит CONNECTING; переоткрываем только CLOSED
        if (stopped || es?.readyState !== EventSource.CLOSED) return
        es?.close()
        retryTimer = setTimeout(connect, 5000)
      }
    }

    connect()

    onBeforeUnmount(() => {
      stopped = true
      es?.close()
      if (retryTimer) clearTimeout(retryTimer)
    })
  }

  return { unread, refreshUnread, startStream }
}
