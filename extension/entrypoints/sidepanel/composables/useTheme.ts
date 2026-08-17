import { ref, watch } from 'vue'

export type Theme = 'light' | 'dark'

const theme = ref<Theme>('light')
let initialised = false

function apply(t: Theme) {
  const el = document.documentElement
  // Плавная смена темы
  el.classList.add('theme-transition')
  el.classList.toggle('dark', t === 'dark')
  el.classList.toggle('light', t !== 'dark')
  // Снимаем transition-класс после анимации
  window.setTimeout(() => el.classList.remove('theme-transition'), 400)
}

export function useTheme() {
  function toggle() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
    apply(theme.value)
    chrome.storage?.local?.set({ theme: theme.value }).catch(() => {})
  }

  async function load() {
    if (initialised) return
    initialised = true
    const sysDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
    try {
      const stored = await chrome.storage?.local?.get('theme')
      theme.value = (stored?.theme as Theme) ?? (sysDark ? 'dark' : 'light')
    } catch {
      theme.value = sysDark ? 'dark' : 'light'
    }
    apply(theme.value)
  }

  return { theme, toggle, load }
}

/** Ручной тумблер «Уменьшить анимацию», перекрывающий системную настройку. */
const reducedMotionOverride = ref<boolean | null>(null)
export function useReducedMotion() {
  const systemPrefers = ref(
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  mq?.addEventListener?.('change', (e) => { systemPrefers.value = e.matches })

  async function loadPref() {
    try {
      const stored = await chrome.storage?.local?.get('reducedMotion')
      reducedMotionOverride.value =
        stored?.reducedMotion === true || stored?.reducedMotion === false
          ? stored.reducedMotion
          : null
    } catch { /* default to system */ }
  }

  function setOverride(v: boolean | null) {
    reducedMotionOverride.value = v
    chrome.storage?.local?.set({ reducedMotion: v }).catch(() => {})
  }

  watch([systemPrefers, reducedMotionOverride], () => {
    const effective =
      reducedMotionOverride.value ?? systemPrefers.value
    document.documentElement.classList.toggle('hf-reduced', effective)
  }, { immediate: true })

  return { systemPrefers, reducedMotionOverride, loadPref, setOverride }
}
