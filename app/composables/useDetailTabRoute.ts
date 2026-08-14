/**
 * useDetailTabRoute — синхронизация активной вкладки detail c URL query (?tab=…).
 * - Читает `?tab` при монтировании.
 * - Пишет `?tab` при смене (replace, без history stack).
 * - Fallback на первую доступную вкладку, если значение не в списке.
 */
import { computed, ref, watch, onMounted } from 'vue'
import type { Ref } from 'vue'

export interface UseDetailTabRouteOptions {
  /** Список доступных ключей вкладок (для валидации URL). */
  available: () => string[]
  /** Ключ вкладки по умолчанию. */
  defaultTab: string
  /** Имя query-параметра (для nested detail можно передать 'ctab' и т.п.). */
  queryKey?: string
  /** Отключить синхронизацию с URL (например, если панель внутри списка). */
  disabled?: boolean
}

export function useDetailTabRoute(options: UseDetailTabRouteOptions): Ref<string> {
  const route = useRoute()
  const router = useRouter()
  const key = options.queryKey ?? 'tab'
  const active = ref(options.defaultTab)

  function normalize(v: unknown): string {
    const s = typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : ''
    const list = options.available()
    if (s && list.includes(s)) return s
    return options.defaultTab
  }

  onMounted(() => {
    if (options.disabled) return
    active.value = normalize((route.query as Record<string, unknown>)[key])
  })

  watch(active, (v) => {
    if (options.disabled) return
    const current = (route.query as Record<string, unknown>)[key]
    if (current === v) return
    const q = { ...route.query, [key]: v }
    router.replace({ query: q }).catch(() => {})
  })

  // Реакция на back/forward — если URL сменился, обновим active
  watch(() => (route.query as Record<string, unknown>)[key], (v) => {
    if (options.disabled) return
    const next = normalize(v)
    if (next !== active.value) active.value = next
  })

  return active
}
