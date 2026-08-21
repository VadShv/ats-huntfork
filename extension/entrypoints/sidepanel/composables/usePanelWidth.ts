import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Ширина панели задаётся браузером (пользователь тянет край side panel).
 * Мы её не переопределяем — только следим за фактической шириной окна,
 * чтобы разворачивать рельс на широкой панели.
 */
const RAIL_EXPAND_AT = 560

const panelWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 400)
const railExpanded = ref(false)
/** Ручное закрепление рельса пользователем (перекрывает авто-режим). */
const railPinned = ref<boolean | null>(null)

let listenerAttached = false

function sync() {
  panelWidth.value = window.innerWidth
  railExpanded.value = railPinned.value ?? (panelWidth.value > RAIL_EXPAND_AT)
}

export function usePanelWidth() {
  function load() {
    if (!listenerAttached) {
      listenerAttached = true
      window.addEventListener('resize', sync, { passive: true })
    }
    sync()
  }

  function toggleRail() {
    railPinned.value = !railExpanded.value
    sync()
  }

  return { panelWidth, railExpanded, load, toggleRail }
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
