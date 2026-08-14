/**
 * Спринт 19.5: глобальный счётчик непрочитанных для бейджа «Входящие».
 *
 * Общее состояние (useState) + фоновый опрос лёгкого эндпоинта раз в 30с,
 * только при видимой вкладке браузера. Опрос запускает AppTopBar (один на
 * приложение), страница Инбокса синхронизирует значение при своих refresh.
 */
export function useInboxUnread() {
  const unread = useState<number>('inbox-unread-total', () => 0)

  async function refreshUnread() {
    try {
      const res = await $fetch<{ unread: number }>('/api/conversations/unread-count')
      unread.value = res.unread
    }
    catch {
      // молча: сеть/401 — бейдж просто не обновится
    }
  }

  /** Запустить фоновый опрос (вызывать в onMounted одного компонента). */
  function startPolling(intervalMs = 30000) {
    refreshUnread()
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      refreshUnread()
    }, intervalMs)
    onBeforeUnmount(() => clearInterval(timer))
  }

  return { unread, refreshUnread, startPolling }
}
