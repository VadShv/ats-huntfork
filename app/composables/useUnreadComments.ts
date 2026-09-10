/**
 * Unread comment indicators — fetches unread notifications for application comments.
 * Provides per-application unread counts and mark-as-read.
 */
import { ref, computed } from 'vue'

interface NotificationRow {
  id: string
  type: string
  entityType: string
  entityId: string
  commentId: string | null
  readAt: string | null
}

export function useUnreadComments() {
  const notifications = ref<NotificationRow[]>([])
  const loading = ref(false)

  /** Map<applicationId, unreadCount> */
  const unreadByApp = computed(() => {
    const map = new Map<string, number>()
    for (const n of notifications.value) {
      if (n.entityType === 'application_comment' && !n.readAt) {
        map.set(n.entityId, (map.get(n.entityId) ?? 0) + 1)
      }
    }
    return map
  })

  async function fetchUnread() {
    loading.value = true
    try {
      const res = await $fetch<{ data: NotificationRow[] }>(
        '/api/notifications',
        { query: { unread: true, limit: 100 } },
      )
      notifications.value = res.data ?? []
    } catch {
      notifications.value = []
    } finally {
      loading.value = false
    }
  }

  function unreadCount(applicationId: string): number {
    return unreadByApp.value.get(applicationId) ?? 0
  }

  async function markRead(applicationId: string) {
    const ids = notifications.value
      .filter(n => n.entityId === applicationId && !n.readAt)
      .map(n => n.id)
    if (ids.length === 0) return
    try {
      await $fetch('/api/notifications/read', {
        method: 'POST',
        body: { ids },
      })
      notifications.value = notifications.value.filter(n => !ids.includes(n.id))
    } catch {
      // soft fail
    }
  }

  return { unreadByApp, loading, fetchUnread, unreadCount, markRead }
}
