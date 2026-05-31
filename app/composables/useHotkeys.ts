import { onMounted, onBeforeUnmount } from 'vue'

export function useHotkeys(handlers: Record<string, () => void>) {
  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target.isContentEditable
    ) {
      return
    }
    const key = e.key.toLowerCase()
    if (handlers[key]) {
      e.preventDefault()
      handlers[key]!()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
