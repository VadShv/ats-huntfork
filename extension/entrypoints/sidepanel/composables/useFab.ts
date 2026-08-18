/**
 * useFab — плавающая кнопка (FAB) на странице.
 *
 * Инжектируется через chrome.scripting.executeScript (разрешение 'scripting'
 * уже есть в манифесте). Не требует content script в манифесте — работает
 * на любом сайте, где есть host permission.
 *
 * FAB появляется на LinkedIn, GitHub, Хабр Карьере и generic-страницах.
 * Скрывается на hh.ru (там работает контент-скрипт с бейджами) и на chrome://.
 * По клику: открывает side panel или показывает мини-меню.
 */
import { ref, onMounted, onUnmounted } from 'vue'

const FAB_ENABLED_KEY = 'hf:fab:enabled'
const fabEnabled = ref(true)
let lastInjectedTabId = 0
let lastInjectedUrl = ''
let loaded = false

export function useFab() {
  async function load() {
    if (loaded) return
    loaded = true
    try {
      const result = await chrome.storage.local.get(FAB_ENABLED_KEY)
      fabEnabled.value = result[FAB_ENABLED_KEY] !== false
    } catch {
      // storage недоступен
    }
  }

  function persist() {
    try {
      chrome.storage.local.set({ [FAB_ENABLED_KEY]: fabEnabled.value })
    } catch {}
  }

  onMounted(() => { load() })

  /** Проверить, нужно ли показывать FAB на данном URL. */
  function shouldShowFab(url: string | null): boolean {
    if (!url || !fabEnabled.value) return false
    if (!/^https?:\/\//.test(url)) return false
    const host = (() => {
      try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
    })()
    // Скрываем на hh.ru — там контент-скрипт с бейджами
    if (/(^|\.)hh\.ru$/.test(host)) return false
    // Скрываем на huntfork — своя платформа
    if (/(^|\.)huntfork\.ru$/.test(host)) return false
    // Скрываем на служебных страницах
    if (host === '') return false
    return true
  }

  /** Инжектировать FAB во вкладку. */
  async function injectFab(tabId: number, url: string): Promise<boolean> {
    if (!shouldShowFab(url)) {
      await removeFab(tabId)
      return false
    }
    // Не инжектируем повторно на тот же URL
    if (tabId === lastInjectedTabId && url === lastInjectedUrl) return false
    lastInjectedTabId = tabId
    lastInjectedUrl = url

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: fabInjector,
      })
      return true
    } catch {
      // Нет host permission на этот origin — тихо
      return false
    }
  }

  /** Удалить FAB из вкладки. */
  async function removeFab(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const fab = document.getElementById('hf-fab')
          if (fab) fab.remove()
          const menu = document.getElementById('hf-fab-menu')
          if (menu) menu.remove()
        },
      })
    } catch {
      // вкладка могла закрыться
    }
    if (tabId === lastInjectedTabId) {
      lastInjectedTabId = 0
      lastInjectedUrl = ''
    }
  }

  /** Включить/выключить FAB глобально. */
  function setEnabled(enabled: boolean) {
    fabEnabled.value = enabled
    persist()
    if (!enabled) {
      // Пытаемся убрать с текущей вкладки
      chrome.tabs?.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]?.id) removeFab(tabs[0].id)
      }).catch(() => {})
    }
  }

  return {
    fabEnabled,
    load,
    injectFab,
    removeFab,
    setEnabled,
    shouldShowFab,
  }
}

/**
 * Функция, инжектируемая на страницу.
 * Создаёт FAB в DOM. Стили инлайнятся, чтобы не зависеть от CSS панели.
 */
function fabInjector() {
  // Удаляем старый, если есть
  const existing = document.getElementById('hf-fab')
  if (existing) existing.remove()
  const existingMenu = document.getElementById('hf-fab-menu')
  if (existingMenu) existingMenu.remove()

  const fab = document.createElement('div')
  fab.id = 'hf-fab'
  fab.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #111111;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(0, 0, 0, 0.15);
    cursor: pointer;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    user-select: none;
    font-family: system-ui, -apple-system, sans-serif;
  `

  // SVG-иконка — стилизованный «прицел» (logo)
  fab.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  `

  fab.addEventListener('mouseenter', () => {
    fab.style.transform = 'scale(1.08)'
    fab.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.3), 0 3px 8px rgba(0, 0, 0, 0.2)'
  })
  fab.addEventListener('mouseleave', () => {
    fab.style.transform = 'scale(1)'
    fab.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(0, 0, 0, 0.15)'
  })

  let menuOpen = false

  function toggleMenu(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    menuOpen = !menuOpen
    if (menuOpen) showMenu()
    else hideMenu()
  }

  function showMenu() {
    const menu = document.createElement('div')
    menu.id = 'hf-fab-menu'
    menu.style.cssText = `
      position: fixed;
      bottom: 82px;
      right: 24px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08);
      padding: 6px;
      z-index: 2147483647;
      min-width: 180px;
      font-family: system-ui, -apple-system, sans-serif;
      animation: hf-fab-in 0.15s ease-out;
    `

    // Добавляем keyframes для анимации
    if (!document.getElementById('hf-fab-style')) {
      const style = document.createElement('style')
      style.id = 'hf-fab-style'
      style.textContent = `
        @keyframes hf-fab-in {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `
      document.documentElement.appendChild(style)
    }

    const actions = [
      { label: 'Захватить профиль', icon: '📥', action: 'capture' },
      { label: 'Сводка по странице', icon: '✨', action: 'summary' },
      { label: 'Проверить данные', icon: '🔍', action: 'verify' },
      { label: 'Добавить в очередь', icon: '📋', action: 'queue' },
    ]

    for (const act of actions) {
      const btn = document.createElement('button')
      btn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 10px 12px;
        border: none;
        background: none;
        cursor: pointer;
        border-radius: 8px;
        font-size: 14px;
        color: #1a1a2e;
        text-align: left;
        transition: background 0.12s ease;
      `
      btn.innerHTML = `<span style="font-size: 16px;">${act.icon}</span> ${act.label}`
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(17, 17, 17, 0.08)'
      })
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'none'
      })
      btn.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        chrome.runtime.sendMessage({ type: 'fabAction', action: act.action })
        hideMenu()
      })
      menu.appendChild(btn)
    }

    document.body.appendChild(menu)

    // Закрытие по клику вне меню
    setTimeout(() => {
      document.addEventListener('click', onOutsideClick)
    }, 0)
  }

  function onOutsideClick(e: MouseEvent) {
    const menu = document.getElementById('hf-fab-menu')
    const fabEl = document.getElementById('hf-fab')
    if (menu && !menu.contains(e.target as Node) && fabEl && !fabEl.contains(e.target as Node)) {
      hideMenu()
    }
  }

  function hideMenu() {
    menuOpen = false
    const menu = document.getElementById('hf-fab-menu')
    if (menu) menu.remove()
    document.removeEventListener('click', onOutsideClick)
  }

  fab.addEventListener('click', toggleMenu)

  // Появление с анимацией
  fab.style.opacity = '0'
  fab.style.transform = 'scale(0.8)'
  document.body.appendChild(fab)
  requestAnimationFrame(() => {
    fab.style.opacity = '1'
    fab.style.transform = 'scale(1)'
  })
}
