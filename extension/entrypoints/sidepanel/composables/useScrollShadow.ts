import { ref, watch, onScopeDispose } from 'vue'

/**
 * useScrollShadow — ставит класс is-scrolled на липкую шапку
 * при прокрутке контейнера выше порога.
 *
 * rAF НЕ используется: в backgrounded side panel (CDP-controlled)
 * он не срабатывает. Троттлинг через setTimeout-флаг.
 */
export function useScrollShadow(
  threshold = 12,
): {
  scrolled: ReturnType<typeof ref<boolean>>
  bind: (el: Element | null) => void
} {
  const scrolled = ref(false)
  let container: HTMLElement | null = null
  let ticking = false

  function update() {
    ticking = false
    if (!container) return
    scrolled.value = container.scrollTop > threshold
  }

  function onScroll() {
    if (ticking) return
    ticking = true
    setTimeout(update, 16)
  }

  function bind(el: Element | null) {
    if (container) {
      container.removeEventListener('scroll', onScroll)
    }
    container = (el as HTMLElement) || null
    if (container) {
      container.addEventListener('scroll', onScroll, { passive: true })
      update()
    }
  }

  onScopeDispose(() => {
    if (container) container.removeEventListener('scroll', onScroll)
  })

  return { scrolled, bind }
}
