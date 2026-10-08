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
  | 'stage_comment'

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

/** Сообщение, отправленное вместе со сменой этапа (новая оболочка). */
export interface StageCommentPayload {
  fromStageId: string | null
  fromStageName: string | null
  toStageId: string
  toStageName: string
  toStageColor: string | null
  toParentStageName: string | null
  movedAt: string
}

export interface ThreadComment {
  id: string
  body: string
  bodyHtml: string | null
  isInternal: boolean
  /** Collaboration Hub (Этап 3): тип записи ленты (null/'text' — обычный комментарий). */
  kind: CommentKind | null
  /** Снимок данных виджета для kind !== 'text'. */
  payloadJson: ScreeningSnapshotPayload | RiskSnapshotPayload | StageCommentPayload | Record<string, unknown> | null
  parentCommentId: string | null
  isPinned: boolean
  pinnedAt?: string | Date | null
  /** Личное закрепление текущего пользователя (comment_pin_personal). */
  isPinnedByMe?: boolean
  editedAt: string | Date | null
  createdAt: string | Date
  updatedAt: string | Date
  author: CommentAuthor
  mentions: CommentMention[]
  reactions: CommentReaction[]
  attachments: CommentAttachment[]
  /** hh.ru comment sync state: 'local' | 'pending' | 'synced' | 'failed' */
  hhSyncStatus?: string | null
  /** hh.ru message direction: 'outbound' | 'incoming' */
  hhDirection?: string | null
  /** hh.ru message ID (for dedup) */
  hhMessageId?: string | null
  /** hh.ru author display name (for incoming comments) */
  hhAuthorName?: string | null
  /** hh.ru comment creation time (for incoming comments) */
  hhSyncedAt?: string | Date | null
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
  /** Есть ли сообщения старше самого раннего загруженного. */
  const hasMore = useState<boolean>(`app-comments-has-more:${applicationId}`, () => false)
  const loadingMore = useState<boolean>(`app-comments-loading-more:${applicationId}`, () => false)
  const toast = useToast()

  /** Время сообщения в ленте: для входящих с hh — дата на hh, иначе дата создания. */
  function effectiveAt(c: ThreadComment): number {
    return new Date(c.hhSyncedAt ?? c.createdAt).getTime()
  }

  const PAGE_SIZE = 50
  const MAX_LIMIT = 200

  interface CommentsPage { data: ThreadComment[], total: number, hasMore: boolean, oldestAt: string | null }

  /**
   * Загрузить/обновить ленту. Запрашиваем столько последних сообщений, сколько уже
   * загружено (минимум страница), чтобы рефетч по SSE не терял подгруженную историю.
   */
  async function fetchComments() {
    loading.value = true
    error.value = null
    try {
      const limit = Math.min(MAX_LIMIT, Math.max(PAGE_SIZE, comments.value.length))
      const res = await $fetch<CommentsPage>(
        `/api/applications/${applicationId}/comments`,
        { query: { limit } },
      )
      comments.value = res.data
      hasMore.value = res.hasMore
    } catch (e: any) {
      error.value = e?.data?.statusMessage ?? e?.message ?? 'Не удалось загрузить тред'
    } finally {
      loading.value = false
    }
  }

  /** Подгрузить страницу сообщений старше самого раннего загруженного. Возвращает число добавленных. */
  async function loadOlder(): Promise<number> {
    if (loadingMore.value || !hasMore.value) return 0
    const oldest = comments.value[0]
    if (!oldest) return 0
    loadingMore.value = true
    try {
      const res = await $fetch<CommentsPage>(
        `/api/applications/${applicationId}/comments`,
        { query: { limit: PAGE_SIZE, before: new Date(effectiveAt(oldest)).toISOString() } },
      )
      const known = new Set(comments.value.map(c => c.id))
      const fresh = res.data.filter(c => !known.has(c.id))
      comments.value = [...fresh, ...comments.value]
      hasMore.value = res.hasMore
      return fresh.length
    } catch (e: any) {
      toast.error('Не удалось загрузить историю', { message: e?.data?.statusMessage ?? e?.message })
      return 0
    } finally {
      loadingMore.value = false
    }
  }

  /**
   * Переключить закрепление. scope='all' — для всех (виден всем участникам, нужен
   * доступ application:update); scope='me' — личное, только для текущего пользователя.
   */
  async function togglePin(commentId: string, scope: 'all' | 'me' = 'all') {
    const idx = comments.value.findIndex(c => c.id === commentId)
    try {
      const res = await $fetch<{ id: string, scope: 'all' | 'me', isPinned?: boolean, isPinnedByMe?: boolean }>(
        `/api/applications/${applicationId}/comments/${commentId}/pin`,
        { method: 'POST', body: { scope } },
      )
      if (idx >= 0) {
        const cur = comments.value[idx]!
        comments.value[idx] = scope === 'me'
          ? { ...cur, isPinnedByMe: res.isPinnedByMe ?? !cur.isPinnedByMe }
          : { ...cur, isPinned: res.isPinned ?? !cur.isPinned, pinnedAt: res.isPinned ? new Date().toISOString() : null }
      }
      return res
    } catch (e: any) {
      toast.error('Не удалось изменить закрепление', { message: e?.data?.statusMessage ?? e?.message })
      throw e
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

  async function createComment(payload: { body: string; isInternal?: boolean; parentCommentId?: string; hhLocalOnly?: boolean; moveToStageId?: string }) {
    try {
      const created = await $fetch<ThreadComment>(
        `/api/applications/${applicationId}/comments`,
        { method: 'POST', body: { ...payload, hhLocalOnly: payload.hhLocalOnly ?? false } },
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

  /**
   * Поставить/снять реакцию. Оптимистично правим локальный список, затем подменяем его
   * серверным (`reactions` в ответе POST/DELETE) — так чип виден сразу и не зависит от
   * SSE-рефетча. При ошибке — тост и полный рефетч.
   */
  async function toggleReaction(commentId: string, emoji: string, currentUserId: string) {
    const comment = comments.value.find(c => c.id === commentId)
    if (!comment) return
    if (!Array.isArray(comment.reactions)) comment.reactions = []
    const existing = comment.reactions.find(r => r.emoji === emoji)
    const reactedByMe = !!existing?.reactedByMe

    const applyServer = (res: { reactions?: CommentReaction[] } | null | undefined) => {
      if (res && Array.isArray(res.reactions)) {
        const target = comments.value.find(c => c.id === commentId)
        if (target) target.reactions = res.reactions
      }
    }

    // optimistic update
    if (reactedByMe) {
      if (existing) {
        existing.count = Math.max(0, existing.count - 1)
        existing.userIds = existing.userIds.filter(uid => uid !== currentUserId)
        existing.reactedByMe = false
        if (existing.count === 0) {
          comment.reactions = comment.reactions.filter(r => r.emoji !== emoji)
        }
      }
      try {
        const res = await $fetch<{ reactions?: CommentReaction[] } | null>(
          `/api/applications/${applicationId}/comments/${commentId}/reactions/${encodeURIComponent(emoji)}`,
          { method: 'DELETE' },
        )
        applyServer(res)
      } catch (e: any) {
        toast.error('Не удалось убрать реакцию', { message: e?.data?.statusMessage ?? e?.message, statusCode: e?.statusCode })
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
        const res = await $fetch<{ reactions?: CommentReaction[] }>(
          `/api/applications/${applicationId}/comments/${commentId}/reactions`,
          { method: 'POST', body: { emoji } },
        )
        applyServer(res)
      } catch (e: any) {
        toast.error('Не удалось добавить реакцию', { message: e?.data?.statusMessage ?? e?.message, statusCode: e?.statusCode })
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
      items.push({ type: 'comment', at: effectiveAt(c), comment: c })
    }
    // Пока есть незагруженная история — события этапов старше первого загруженного
    // сообщения не показываем, иначе лента начнётся с «висящих» переводов без контекста.
    const oldestLoaded = hasMore.value && comments.value.length > 0 ? effectiveAt(comments.value[0]!) : -Infinity
    for (const e of stageEvents.value) {
      const at = new Date(e.movedAt).getTime()
      if (at < oldestLoaded) continue
      items.push({ type: 'stage_event', at, event: e })
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
    hasMore,
    loadingMore,
    fetchComments,
    loadOlder,
    togglePin,
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
