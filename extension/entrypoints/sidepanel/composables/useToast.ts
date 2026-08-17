import { ref } from 'vue'

export type ToastTone = 'default' | 'success' | 'error'

export interface HfToast {
  id: number
  message: string
  tone: ToastTone
}

const toasts = ref<HfToast[]>([])
let seq = 0

function dismiss(id: number) {
  const idx = toasts.value.findIndex(t => t.id === id)
  if (idx >= 0) toasts.value.splice(idx, 1)
}

/** Показать тост. Автоматически исчезает через 2.2 с. */
function toast(message: string, tone: ToastTone = 'default') {
  const id = ++seq
  toasts.value.push({ id, message, tone })
  setTimeout(() => dismiss(id), 2200)
  return id
}

export function useToast() {
  return { toasts, toast, dismiss }
}
