import { onScopeDispose } from 'vue'

/**
 * useSpecular — спекулярный блик «стекло»: радиальный градиент
 * следует за курсором внутри карточки. Координаты --mx/--my
 * ставятся как CSS-переменные в процентах.
 *
 * rAF НЕ используется (не срабатывает в backgrounded side panel).
 * Троттлинг через setTimeout-флаг ~16мс.
 *
 * Блик гасится при prefers-reduced-motion / prefers-contrast: more
 * (см. polish.css .hf-specular::before).
 */
export function useSpecular() {
  let el: HTMLElement | null = null
  let ticking = false

  function update(e: MouseEvent) {
    ticking = false
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }

  function onMove(e: MouseEvent) {
    if (ticking) return
    ticking = true
    // setTimeout, не rAF
    setTimeout(() => update(e), 16)
  }

  function bind(target: Element | null) {
    el = (target as HTMLElement) || null
  }

  onScopeDispose(() => {
    el = null
  })

  return { onMove, bind }
}
