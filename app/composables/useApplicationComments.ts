/**
 * Composable wrapping the collaboration-thread REST API.
 * One instance per applicationId.
 */
import { computed, ref } from 'vue'

export interface CommentAuthor {
  id: string
  name: string | null
  email: string | null
  image: string | null
}

export interface CommentMention {
  userId: string
  name?: string | null
  email?: string | null
}

export interface CommentReaction {
  emoji: string
  count: number
  userIds: string[]
  reactedByMe: boolean
}

export interface CommentAttachment {
  id: string
  commentId: string
  fileName: string
  storageKey: string
  mimeType: string
  sizeBytes: number
  uploadedByUserId: string
  createdAt: string | Date
}

export interface ThreadComment {
  id: string
  body: string
  bodyHtml: string | null
  isInternal: boolean
  parentCommentId: string | null
  editedAt: string | Date | null
  createdAt: string | Date
  updatedAt: string | Date
  author: CommentAuthor
  mentions: CommentMention[]
  reactions: CommentReaction[]
  attachments: CommentAttachment[]
}

export interface OrgMember {
  userId: string
  name: string | null
  email: string | null
  image: string | null
  role: string
}

export interface Watcher {
  userId: string
  source: 'manual' | 'auto_mention' | 'auto_author' | 'auto_assignee'
  createdAt: string | Date
  name: string | null
  email: string | null
  image: string | null
}

export function useApplicationComments(applicationId: string) {
  // Use Nuxt useState to share state across components mounted for the same applicationId
  // (e.g. Composer + Thread, or page + drawer) so optimistic updates propagate.
  const comments = useState<ThreadComment[]>(`app-comments:${applicationId}`, () => [])
  const watchers = useState<Watcher[]>(`app-watchers:${applicationId}`, () => [])
  const loading = useState<boolean>(`app-comments-loading:${applicationId}`, () => false)
  const error = useState<string | null>(`app-comments-error:${applicationId}`, () => null)
  const toast = useToast()

  async function fetchComments() {
    loading.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: ThreadComment[]; total: number }>(
        `/api/applications/${applicationId}/comments`,
      )
      comments.value = res.data
    } catch (e: any) {
      error.value = e?.data?.statusMessage ?? e?.message ?? 'Не удалось загрузить тред'
    } finally {
      loading.value = false
    }
  }

  async function fetchWatchers() {
    try {
      const res = await $fetch<{ data: Watcher[] }>(`/api/applications/${applicationId}/watchers`)
      watchers.value = res.data
    } catch (e: any) {
      // soft fail — UI continues
    }
  }

  async function createComment(payload: { body: string; isInternal?: boolean; parentCommentId?: string }) {
    try {
      const created = await $fetch<ThreadComment>(
        `/api/applications/${applicationId}/comments`,
        { method: 'POST', body: payload },
      )
      comments.value.push(created)
      void fetchWatchers()
      return created
    } catch (e: any) {
      toast.error('Не удалось отправить комментарий', { message: e?.data?.statusMessage ?? e?.message })
      throw e
    }
  }

  async function updateComment(commentId: string, body: string) {
    try {
      const updated = await $fetch<ThreadComment>(
        `/api/applications/${applicationId}/comments/${commentId}`,
        { method: 'PATCH', body: { body } },
      )
      const idx = comments.value.findIndex(c => c.id === commentId)
      if (idx >= 0) {
        comments.value[idx] = { ...comments.value[idx], ...updated }
      }
      return updated
    } catch (e: any) {
      toast.error('Не удалось сохранить изменения', { message: e?.data?.statusMessage ?? e?.message })
      throw e
    }
  }

  async function deleteComment(commentId: string) {
    try {
      await $fetch(`/api/applications/${applicationId}/comments/${commentId}`, { method: 'DELETE' })
      comments.value = comments.value.filter(c => c.id !== commentId)
    } catch (e: any) {
      toast.error('Не удалось удалить комментарий', { message: e?.data?.statusMessage ?? e?.message })
      throw e
    }
  }

  async function addWatcher(userId: string) {
    try {
      await $fetch(`/api/applications/${applicationId}/watchers`, {
        method: 'POST',
        body: { userId },
      })
      await fetchWatchers()
    } catch (e: any) {
      toast.error('Не удалось добавить подписчика', { message: e?.data?.statusMessage ?? e?.message })
    }
  }

  async function removeWatcher(userId: string) {
    try {
      await $fetch(`/api/applications/${applicationId}/watchers/${userId}`, { method: 'DELETE' })
      watchers.value = watchers.value.filter(w => w.userId !== userId)
    } catch (e: any) {
      toast.error('Не удалось отписаться', { message: e?.data?.statusMessage ?? e?.message })
    }
  }

  async function toggleReaction(commentId: string, emoji: string, currentUserId: string) {
    const comment = comments.value.find(c => c.id === commentId)
    if (!comment) return
    const existing = comment.reactions.find(r => r.emoji === emoji)
    const reactedByMe = !!existing?.reactedByMe

    // optimistic update
    if (reactedByMe) {
      // remove
      if (existing) {
        existing.count = Math.max(0, existing.count - 1)
        existing.userIds = existing.userIds.filter(uid => uid !== currentUserId)
        existing.reactedByMe = false
        if (existing.count === 0) {
          comment.reactions = comment.reactions.filter(r => r.emoji !== emoji)
        }
      }
      try {
        await $fetch(
          `/api/applications/${applicationId}/comments/${commentId}/reactions/${encodeURIComponent(emoji)}`,
          { method: 'DELETE' },
        )
      } catch (e: any) {
        toast.error('Не удалось убрать реакцию', { message: e?.data?.statusMessage ?? e?.message })
        await fetchComments()
      }
    } else {
      if (existing) {
        existing.count += 1
        existing.userIds.push(currentUserId)
        existing.reactedByMe = true
      } else {
        comment.reactions.push({ emoji, count: 1, userIds: [currentUserId], reactedByMe: true })
      }
      try {
        await $fetch(
          `/api/applications/${applicationId}/comments/${commentId}/reactions`,
          { method: 'POST', body: { emoji } },
        )
      } catch (e: any) {
        toast.error('Не удалось добавить реакцию', { message: e?.data?.statusMessage ?? e?.message })
        await fetchComments()
      }
    }
  }

  async function uploadAttachment(commentId: string, file: File): Promise<CommentAttachment | null> {
    const form = new FormData()
    form.append('file', file)
    try {
      const created = await $fetch<CommentAttachment>(
        `/api/applications/${applicationId}/comments/${commentId}/attachments`,
        { method: 'POST', body: form },
      )
      const comment = comments.value.find(c => c.id === commentId)
      if (comment) comment.attachments.push(created)
      return created
    } catch (e: any) {
      toast.error('Не удалось загрузить файл', { message: e?.data?.statusMessage ?? e?.message })
      return null
    }
  }

  async function deleteAttachment(commentId: string, attachmentId: string) {
    try {
      await $fetch(
        `/api/applications/${applicationId}/comments/${commentId}/attachments/${attachmentId}`,
        { method: 'DELETE' },
      )
      const comment = comments.value.find(c => c.id === commentId)
      if (comment) comment.attachments = comment.attachments.filter(a => a.id !== attachmentId)
    } catch (e: any) {
      toast.error('Не удалось удалить файл', { message: e?.data?.statusMessage ?? e?.message })
    }
  }

  async function searchMembers(q: string): Promise<OrgMember[]> {
    try {
      const res = await $fetch<{ data: OrgMember[] }>(
        `/api/applications/${applicationId}/members`,
        { query: { q, limit: 10 } },
      )
      return res.data
    } catch {
      return []
    }
  }

  const total = computed(() => comments.value.length)

  return {
    comments,
    watchers,
    loading,
    error,
    total,
    fetchComments,
    fetchWatchers,
    createComment,
    updateComment,
    deleteComment,
    addWatcher,
    removeWatcher,
    toggleReaction,
    uploadAttachment,
    deleteAttachment,
    searchMembers,
  }
}
