/**
 * Обсуждение отдельным окном (ТЗ docs/tz-discussion-window.md).
 *
 * Одно именованное окно браузера с тредом отклика без меню и шапки приложения
 * (роут /dashboard/applications/:id/discussion). Повторный вызов `open()` с
 * другим откликом переключает уже открытое окно, а не плодит новые.
 *
 * Между вкладками одного браузера общаемся через BroadcastChannel:
 *   - stage-changed   — этап переведён (из окна или из карточки): получатели
 *                        обновляют карточку/воронку тем же обработчиком, что и
 *                        при @stage-changed от треда;
 *   - window-opened / window-closed — чтобы меню «⋯» показывало «Открыто в окне».
 * Без BroadcastChannel (старый Safari) теряется только мгновенное обновление
 * этапа в основном окне — его подхватит рефетч треда по SSE.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import type { StageMoveResult } from '~/composables/useApplicationStages'

export const DISCUSSION_WINDOW_NAME = 'huntfork-discussion'
const CHANNEL_NAME = 'huntfork-discussion'
const BOUNDS_KEY = 'discussion-window:bounds'
/** Минимальная ширина экрана, на которой попап имеет смысл. */
const MIN_SCREEN_WIDTH = 1024
const DEFAULT_WIDTH = 560
const DEFAULT_HEIGHT = 900

export type DiscussionWindowMessage =
  | { type: 'stage-changed', applicationId: string, payload: StageMoveResult }
  | { type: 'window-opened', applicationId: string }
  | { type: 'window-closed' }

interface WindowBounds { width: number, height: number, left: number, top: number }

function readBounds(): WindowBounds | null {
  try {
    const raw = window.localStorage.getItem(BOUNDS_KEY)
    return raw ? JSON.parse(raw) as WindowBounds : null
  } catch {
    return null
  }
}

export function saveDiscussionWindowBounds() {
  if (typeof window === 'undefined') return
  try {
    const b: WindowBounds = { width: window.outerWidth, height: window.outerHeight, left: window.screenX, top: window.screenY }
    window.localStorage.setItem(BOUNDS_KEY, JSON.stringify(b))
  } catch {
    // квота/приватный режим — не критично
  }
}

/** Ленивый канал на вкладку; один на все подписчики. */
let channel: BroadcastChannel | null = null
let channelRefs = 0
function acquireChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return null
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
  channelRefs++
  return channel
}
function releaseChannel() {
  channelRefs = Math.max(0, channelRefs - 1)
  if (channelRefs === 0 && channel) {
    channel.close()
    channel = null
  }
}

export function useDiscussionWindow() {
  /** Отклик, открытый сейчас в окне (по сообщениям window-opened / window-closed). */
  const openedApplicationId = useState<string | null>('discussion-window:opened', () => null)
  const { t } = useI18n()
  const toast = useToast()
  const localePath = useLocalePath()

  const canUseWindow = computed(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth >= MIN_SCREEN_WIDTH
  })

  const handlers = new Set<(msg: DiscussionWindowMessage) => void>()
  const ch = acquireChannel()
  const onMessage = (e: MessageEvent<DiscussionWindowMessage>) => {
    const msg = e.data
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'window-opened') openedApplicationId.value = msg.applicationId
    if (msg.type === 'window-closed') openedApplicationId.value = null
    for (const h of handlers) h(msg)
  }
  ch?.addEventListener('message', onMessage)
  onBeforeUnmount(() => {
    ch?.removeEventListener('message', onMessage)
    releaseChannel()
  })

  function post(msg: DiscussionWindowMessage) {
    try {
      ch?.postMessage(msg)
    } catch {
      // канал закрыт — молча
    }
  }

  function windowUrl(applicationId: string) {
    return localePath(`/dashboard/applications/${applicationId}/discussion`)
  }

  /** Открыть (или переключить) окно обсуждения на отклик. Вызывать только по клику пользователя. */
  function open(applicationId: string) {
    if (typeof window === 'undefined') return
    const url = windowUrl(applicationId)
    const saved = readBounds()
    const width = saved?.width ?? DEFAULT_WIDTH
    const height = saved?.height ?? Math.min(DEFAULT_HEIGHT, window.screen.availHeight - 40)
    const left = saved?.left ?? Math.max(0, window.screen.availWidth - width - 20)
    const top = saved?.top ?? 40
    const features = `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener=no`
    const win = window.open(url, DISCUSSION_WINDOW_NAME, features)
    if (!win) {
      toast.warning(t('comments.window_blocked_title'), t('comments.window_blocked_hint'))
      window.open(url, '_blank', 'noopener')
      return
    }
    win.focus()
    // Окно само сообщит window-opened после загрузки; до этого считаем его открытым оптимистично.
    openedApplicationId.value = applicationId
  }

  /** Открыто ли окно именно для этого отклика. */
  function isOpenFor(applicationId: string) {
    return computed(() => openedApplicationId.value === applicationId)
  }

  /** Подписка на перевод этапа из другого окна; возвращает отписку. */
  function onStageChanged(handler: (applicationId: string, payload: StageMoveResult) => void): () => void {
    const h = (msg: DiscussionWindowMessage) => {
      if (msg.type === 'stage-changed') handler(msg.applicationId, msg.payload)
    }
    handlers.add(h)
    return () => handlers.delete(h)
  }

  function broadcastStageChanged(applicationId: string, payload: StageMoveResult) {
    post({ type: 'stage-changed', applicationId, payload })
  }
  function announceOpened(applicationId: string) {
    openedApplicationId.value = applicationId
    post({ type: 'window-opened', applicationId })
  }
  function announceClosed() {
    openedApplicationId.value = null
    post({ type: 'window-closed' })
  }

  /** Открыть карточку отклика в основной вкладке (из попапа), иначе — новой вкладкой. */
  function openApplicationInMain(applicationId: string) {
    if (typeof window === 'undefined') return
    const url = localePath(`/dashboard/applications/${applicationId}`)
    const opener = window.opener as Window | null
    if (opener && !opener.closed) {
      try {
        opener.location.href = url
        opener.focus()
        return
      } catch {
        // cross-origin/закрыт — падаем в новую вкладку
      }
    }
    window.open(url, '_blank', 'noopener')
  }

  return {
    canUseWindow,
    openedApplicationId,
    open,
    isOpenFor,
    onStageChanged,
    broadcastStageChanged,
    announceOpened,
    announceClosed,
    openApplicationInMain,
  }
}
