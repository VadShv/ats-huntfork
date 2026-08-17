/**
 * vRipple — директива волны от точки нажатия.
 * ТЗ «Полировка» §ripple. Бесцветная: opacity от currentColor.
 *
 * Использование: <button v-ripple>...</button>
 *
 * rAF не используется — в CDP-controlled sidepanel он не срабатывает.
 * setTimeout надёжен всегда. Волна удаляется после анимации.
 */
import type { Directive } from 'vue'

function createWave(el: HTMLElement, x: number, y: number) {
  const rect = el.getBoundingClientRect()
  const size = Math.max(rect.width, rect.height) * 2.2

  const wave = document.createElement('span')
  wave.className = 'hf-ripple__wave'
  wave.style.width = `${size}px`
  wave.style.height = `${size}px`
  wave.style.left = `${x - rect.left}px`
  wave.style.top = `${y - rect.top}px`

  el.appendChild(wave)
  setTimeout(() => wave.remove(), 680)
}

export const vRipple: Directive<HTMLElement> = {
  mounted(el) {
    el.classList.add('hf-ripple')
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
      createWave(el, e.clientX, e.clientY)
    })
  },
}
