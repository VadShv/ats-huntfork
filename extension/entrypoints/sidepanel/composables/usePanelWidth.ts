import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Ширина панели: min 380, default 420, max 680.
 * Сохраняется в chrome.storage. При ширине > 560 рельс разворачивается.
 */
const STORAGE_KEY = 'panelWidth'
const MIN = 380
const MAX = 680
const DEFAULT = 420

const panelWidth = ref(DEFAULT)
const railExpanded = ref(false)

export function usePanelWidth() {
  async function load() {
    try {
      const stored = await chrome.storage?.local?.get(STORAGE_KEY)
      const w = stored?.[STORAGE_KEY]
      if (typeof w === 'number') {
        panelWidth.value = Math.min(MAX, Math.max(MIN, w))
      }
    } catch { /* default */ }
    updateRail()
  }

  function setWidth(w: number) {
    panelWidth.value = Math.min(MAX, Math.max(MIN, Math.round(w)))
    chrome.storage?.local?.set({ [STORAGE_KEY]: panelWidth.value }).catch(() => {})
    updateRail()
  }

  function toggleRail() {
    railExpanded.value = !railExpanded.value
  }

  function updateRail() {
    railExpanded.value = panelWidth.value > 560
  }

  return { panelWidth, railExpanded, MIN, MAX, load, setWidth, toggleRail }
}

/** Прокрутка: запоминается и восстанавливается при возврате к разделу. */
const scrollMemory = new Map<string, number>()

export function useScrollMemory() {
  function save(key: string, el: HTMLElement | null) {
    if (el) scrollMemory.set(key, el.scrollTop)
  }
  function restore(key: string, el: HTMLElement | null) {
    if (el && scrollMemory.has(key)) {
      el.scrollTop = scrollMemory.get(key) ?? 0
    }
  }
  return { save, restore }
}

/** Простой детектор онлайн-статуса для offline-баннера. */
export function useOnline() {
  const online = ref(navigator.onLine)

  function up() { online.value = true }
  function down() { online.value = false }

  onMounted(() => {
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
  })
  onUnmounted(() => {
    window.removeEventListener('online', up)
    window.removeEventListener('offline', down)
  })

  return { online }
}
