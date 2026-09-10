/**
 * Auto-scroll + "scroll to bottom" FAB for the discussion thread.
 *
 * - On mount and when `itemCount` changes → scroll to bottom (if near bottom).
 * - Tracks whether user scrolled up → shows FAB to jump back.
 * - Smooth behaviour, `scrollbar-thin` ready.
 */
import { ref, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'

export function useThreadScroll(containerRef: Ref<HTMLElement | null>, itemCount: Ref<number>) {
  const showJumpFab = ref(false)
  let wasNearBottom = true

  function isNearBottom(): boolean {
    const el = containerRef.value
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    const el = containerRef.value
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    showJumpFab.value = false
    wasNearBottom = true
  }

  function onScroll() {
    const near = isNearBottom()
    showJumpFab.value = !near
    wasNearBottom = near
  }

  onMounted(() => {
    scrollToBottom('auto')
    containerRef.value?.addEventListener('scroll', onScroll, { passive: true })
  })

  onBeforeUnmount(() => {
    containerRef.value?.removeEventListener('scroll', onScroll)
  })

  watch(itemCount, () => {
    if (wasNearBottom) scrollToBottom('smooth')
  })

  return { showJumpFab, scrollToBottom }
}
