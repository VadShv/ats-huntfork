/**
 * useEscapeStack — стек обработчиков Escape (LIFO).
 * Гарантирует, что при вложенных панелях (preview → drawer → sidebar)
 * Escape закрывает ТОЛЬКО самую верхнюю (последний зарегистрированный).
 */
import { onMounted, onUnmounted, watch, type Ref } from 'vue'

// Глобальный стек handlers на клиенте
const stack: Array<() => void> = []
let installed = false

function ensureInstalled() {
  if (installed || typeof window === 'undefined') return
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    const top = stack[stack.length - 1]
    if (!top) return
    e.preventDefault()
    e.stopPropagation()
    top()
  })
  installed = true
}

/**
 * Регистрирует обработчик, пока `active.value === true`.
 * При закрытии/размонтировании автоматически снимается со стека.
 */
export function useEscapeStack(active: Ref<boolean> | boolean | (() => boolean), onEscape: () => void) {
  const getActive = () => {
    if (typeof active === 'function') return active()
    if (typeof active === 'boolean') return active
    return active.value
  }

  let registered = false
  function register() {
    if (registered) return
    stack.push(onEscape)
    registered = true
  }
  function unregister() {
    if (!registered) return
    const idx = stack.lastIndexOf(onEscape)
    if (idx !== -1) stack.splice(idx, 1)
    registered = false
  }

  onMounted(() => {
    ensureInstalled()
    if (getActive()) register()
  })

  if (typeof active === 'object' && 'value' in (active as object)) {
    watch(active as Ref<boolean>, (v) => {
      if (v) register()
      else unregister()
    })
  }

  onUnmounted(unregister)
}
