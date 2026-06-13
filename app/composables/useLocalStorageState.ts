/**
 * Простой персистентный ref через useState + window.localStorage.
 * Заменяет `useLocalStorage` из @vueuse/core, чтобы не тянуть зависимость.
 *
 * Особенности:
 * - SSR-safe: на сервере localStorage не трогаем, используется только default.
 * - При гидрации читаем значение из localStorage в onMounted.
 * - Меняем значение → пишем в localStorage (watch).
 * - Поддерживает только сериализуемые JSON-значения (boolean, number, string, object).
 */
export function useLocalStorageState<T>(key: string, defaultValue: T) {
  const state = useState<T>(`localStorage:${key}`, () => defaultValue)

  if (import.meta.client) {
    onMounted(() => {
      try {
        const raw = window.localStorage.getItem(key)
        if (raw !== null) {
          state.value = JSON.parse(raw) as T
        }
      }
      catch {
        // ignore parse/access errors
      }
    })

    watch(state, (value) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      }
      catch {
        // ignore storage errors (e.g. quota, privacy mode)
      }
    }, { deep: true })
  }

  return state
}
