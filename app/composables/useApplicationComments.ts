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

export type CommentKind =
  | 'text'
  | 'ai_screening_snapshot'
  | 'risk_snapshot'
  | 'system_event'
  | 'ai_response'
  | 'ai_summary'

export interface ScreeningSnapshotPayload {
  compositeScore: number
  model: string | null
  assessedAt: string | Date | null
  criteria: Array<{ name: string; score: number; maxScore: number }>
}

export interface RiskSnapshotPayload {
  overallRisk: 'low' | 'medium' | 'high'
  overallScore: number
  summary: string | null
  findingsCount: number
  stale: boolean
  assessedAt: string | Date | null
}

export interface ThreadComment {
  id: string
  body: string
  bodyHtml: string | null
  isInternal: boolean
  /** Collaboration Hub (Этап 3): тип записи ленты (null/'text' — обычный комментарий). */
  kind: CommentKind | null
  /** Снимок данных виджета для kind !== 'text'. */
  payloadJson: ScreeningSnapshotPayload | RiskSnapshotPayload | Record<string, unknown> | null
  parentCommentId: string | null
  isPinned: boolean
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

/** Событие смены этапа воронки — для единой ленты (Этап 4). */
export interface StageEvent {
  id: string
  toStageName: string | null
  toStageColor: string | null
  toStageParentName: string | null
  fromStageName: string | null
  fromStageParentName: string | null
  movedByUserName: string | null
  comment: string | null
  movedAt: string
}

/** Элемент единой ленты: комментарий/снимок ИЛИ системное событие. */
export type TimelineItem =
  | { type: 'comment', at: number, comment: ThreadComment }
  | { type: 'stage_event', at: number, event: StageEvent }

export function useApplicationComments(applicationId: string) {
  // Use Nuxt useState to share state across components mounted for the same applicationId
  // (e.g. Composer + Thread, or page + drawer) so optimistic updates propagate.
  const comments = useState<ThreadComment[]>(`app-comments:${applicationId}`, () => [])
  const watchers = useState<Watcher[]>(`app-watchers:${applicationId}`, () => [])
  const stageEvents = useState<StageEvent[]>(`app-stage-events:${applicationId}`, () => [])
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

  async function fetchStageHistory() {
    try {
      const rows = await $fetch<StageEvent[]>(`/api/applications/${applicationId}/stage-history`)
      stageEvents.value = rows
    } catch {
      // soft fail — таймлайн покажет только комментарии
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

  async function attachSnapshot(kind: 'ai_screening_snapshot' | 'risk_snapshot') {
    try {
      const created = await $fetch<ThreadComment>(
        `/api/applications/${applicationId}/comments/snapshot`,
        { method: 'POST', body: { kind } },
      )
      comments.value.push(created)
      void fetchWatchers()
      return created
    } catch (e: any) {
      toast.error('Не удалось прикрепить результат', { message: e?.data?.statusMessage ?? e?.message })
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

  async function summarize(): Promise<ThreadComment | null> {
    try {
      const created = await $fetch<ThreadComment>(
        `/api/applications/${applicationId}/comments/summarize`,
        { method: 'POST' },
      )
      comments.value.push(created)
      void fetchWatchers()
      return created
    } catch (e: any) {
      toast.error('Не удалось сгенерировать резюме', { message: e?.data?.statusMessage ?? e?.message })
      return null
    }
  }

  const total = computed(() => comments.value.length)

  /** Единая лента: комментарии/снимки + события смены этапа, по времени (старые сверху). */
  const timeline = computed<TimelineItem[]>(() => {
    const items: TimelineItem[] = []
    for (const c of comments.value) {
      items.push({ type: 'comment', at: new Date(c.createdAt).getTime(), comment: c })
    }
    for (const e of stageEvents.value) {
      items.push({ type: 'stage_event', at: new Date(e.movedAt).getTime(), event: e })
    }
    return items.sort((a, b) => a.at - b.at)
  })

  /**
   * Realtime (Этап 4): подписка на SSE-поток изменений треда. По пингу —
   * дебаунс-рефетч комментариев и истории этапов. Возвращает функцию отписки.
   * Работает только в браузере. Также парсит typing events.
   */
  const typingUsers = useState<Array<{ userId: string, name: string }>>(`app-typing:${applicationId}`, () => [])

  function connectStream(): () => void {
    if (import.meta.server || typeof EventSource === 'undefined') return () => {}
    let debounce: ReturnType<typeof setTimeout> | null = null
    const es = new EventSource(`/api/applications/${applicationId}/thread-stream`)
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data.typing) {
          typingUsers.value = data.typing
          return
        }
      } catch {}
      if (debounce) return
      debounce = setTimeout(() => {
        debounce = null
        void fetchComments()
        void fetchStageHistory()
      }, 300)
    }
    es.onerror = () => {
      // Браузер сам переподключит EventSource; ничего не делаем.
    }
    return () => {
      if (debounce) clearTimeout(debounce)
      es.close()
    }
  }

  return {
    comments,
    watchers,
    stageEvents,
    timeline,
    loading,
    error,
    total,
    fetchComments,
    fetchWatchers,
    fetchStageHistory,
    connectStream,
    createComment,
    attachSnapshot,
    updateComment,
    deleteComment,
    addWatcher,
    removeWatcher,
    toggleReaction,
    uploadAttachment,
    deleteAttachment,
    searchMembers,
    summarize,
    typingUsers,
  }
}
