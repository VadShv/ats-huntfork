/**
 * Notifications composable — fetches unread count + recent notifications.
 * Polls every 60 seconds. Used by NotificationBell and /dashboard/notifications.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

export interface NotificationItem {
  id: string
  type: 'mention' | 'reply' | 'reaction' | 'new_comment_on_watched'
  entityType: string
  entityId: string
  commentId: string | null
  readAt: string | Date | null
  createdAt: string | Date
  actorUserId: string | null
  actorName: string | null
  actorImage: string | null
  commentBody: string | null
  applicationId: string | null
}

interface FetchOptions {
  unread?: boolean
  page?: number
  limit?: number
}

export function useNotifications(options: { autoPoll?: boolean; pollMs?: number } = {}) {
  const { autoPoll = false, pollMs = 60_000 } = options

  const items = ref<NotificationItem[]>([])
  const unreadCount = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const toast = useToast()

  let timer: ReturnType<typeof setInterval> | null = null

  async function fetchUnreadCount() {
    try {
      const res = await $fetch<{ data: NotificationItem[]; unread: number }>(
        '/api/notifications',
        { query: { unread: true, limit: 1 } },
      )
      unreadCount.value = res.unread ?? 0
    } catch {
      // soft fail
    }
  }

  async function fetchList(opts: FetchOptions = {}) {
    loading.value = true
    error.value = null
    try {
      const query: Record<string, string | number | boolean> = {
        page: opts.page ?? 1,
        limit: opts.limit ?? 20,
      }
      if (opts.unread) query.unread = true
      const res = await $fetch<{ data: NotificationItem[]; unread: number; page: number; limit: number }>(
        '/api/notifications',
        { query },
      )
      items.value = res.data
      unreadCount.value = res.unread ?? 0
      return res
    } catch (e: any) {
      error.value = e?.data?.statusMessage ?? e?.message ?? 'Не удалось загрузить уведомления'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function markAsRead(ids: string[]) {
    if (!ids.length) return
    try {
      await $fetch('/api/notifications/read', {
        method: 'POST',
        body: { ids },
      })
      for (const n of items.value) {
        if (ids.includes(n.id) && !n.readAt) n.readAt = new Date().toISOString()
      }
      unreadCount.value = Math.max(0, unreadCount.value - ids.length)
    } catch (e: any) {
      toast.error('Не удалось отметить как прочитанное', { message: e?.data?.statusMessage ?? e?.message })
    }
  }

  async function markAllAsRead() {
    try {
      await $fetch('/api/notifications/read', {
        method: 'POST',
        body: { all: true },
      })
      const now = new Date().toISOString()
      for (const n of items.value) {
        if (!n.readAt) n.readAt = now
      }
      unreadCount.value = 0
    } catch (e: any) {
      toast.error('Не удалось отметить все', { message: e?.data?.statusMessage ?? e?.message })
    }
  }

  const hasUnread = computed(() => unreadCount.value > 0)

  if (autoPoll) {
    onMounted(() => {
      void fetchUnreadCount()
      timer = setInterval(() => { void fetchUnreadCount() }, pollMs)
    })
    onBeforeUnmount(() => {
      if (timer) clearInterval(timer)
    })
  }

  return {
    items,
    unreadCount,
    hasUnread,
    loading,
    error,
    fetchUnreadCount,
    fetchList,
    markAsRead,
    markAllAsRead,
  }
}
