<script setup lang="ts">
/** App.vue — каркас: PanelShell + роутер views + CommandPalette + Settings + хоткеи. */
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import PanelShell from './layout/PanelShell.vue'
import TopBar from './layout/TopBar.vue'
import CommandPalette from './layout/CommandPalette.vue'
import Toaster from './layout/Toaster.vue'
import HubView from './views/HubView.vue'
import ChatView from './views/ChatView.vue'
import SourcingView from './views/SourcingView.vue'
import ScreeningView from './views/ScreeningView.vue'
import TelegramView from './views/TelegramView.vue'
import OutreachView from './views/OutreachView.vue'
import PipelineView from './views/PipelineView.vue'
import LibraryView from './views/LibraryView.vue'
import SettingsView from './views/SettingsView.vue'
import ShortcutsOverlay from './layout/ShortcutsOverlay.vue'
import { useSidekick, useSidekickActions } from './composables/useSidekick'
import { useQueue } from './composables/useQueue'
import { useTheme } from './composables/useTheme'
import { useReducedMotion } from './composables/useTheme'
import { useOnline } from './composables/usePanelWidth'
import { useFab } from './composables/useFab'
import { useHistory } from './composables/useHistory'

const { activeView } = useSidekick()
const { selectView, init } = useSidekickActions()
const { add: addToQueue } = useQueue()
const { load: loadTheme } = useTheme()
const { loadPref: loadReducedMotion } = useReducedMotion()
const { online } = useOnline()
const { injectFab, load: loadFab } = useFab()
const { load: loadHistory } = useHistory()

const paletteOpen = ref(false)
const settingsOpen = ref(false)
const shortcutsOpen = ref(false)

/** Какой view активен. Для assistant показываем чат или summary. */
const currentView = computed(() => activeView.value)
const VIEW_ORDER = ['chat', 'sourcing', 'screening', 'telegram', 'outreach', 'pipeline', 'library', 'hub'] as const

/** Направление перехода: вперёд (вниз по рельсу) = 1, назад = -1. */
const direction = ref(1)
let prevIndex = 0
const activeIndex = computed(() => VIEW_ORDER.indexOf(currentView.value as any))
watch(activeIndex, (next) => {
  direction.value = next > prevIndex ? 1 : -1
  prevIndex = next
})

/** JS-хуки transition на setTimeout (не rAF): в side panel через CDP rAF
    не стреляет (страница «не видна»), из-за чего CSS-transitions Vue
    зависают на leave. setTimeout надёжен везде. */
const LEAVE_MS = 170
const ENTER_MS = 280

function onViewEnter(el: Element, done: () => void) {
  const n = el as HTMLElement
  n.style.transition = 'none'
  n.style.opacity = '0'
  n.style.transform = `translate3d(${direction.value * 12}px, 0, 0)`
  setTimeout(() => {
    n.style.transition = `opacity ${ENTER_MS}ms var(--hf-ease-out), transform ${ENTER_MS}ms var(--spring-gentle)`
    n.style.opacity = '1'
    n.style.transform = 'translate3d(0, 0, 0)'
    setTimeout(() => { n.style.transition = ''; n.style.transform = ''; done() }, ENTER_MS + 20)
  }, 16)
}
function onViewLeave(el: Element, done: () => void) {
  const n = el as HTMLElement
  n.style.position = 'absolute'
  n.style.inset = '0'
  n.style.transition = `opacity ${LEAVE_MS}ms var(--hf-ease-in), transform ${LEAVE_MS}ms var(--hf-ease-in)`
  setTimeout(() => {
    n.style.opacity = '0'
    n.style.transform = `translate3d(${direction.value * -8}px, 0, 0)`
    setTimeout(() => { done() }, LEAVE_MS + 20)
  }, 16)
}

function onKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen.value = !paletteOpen.value; return }
  if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); paletteOpen.value = false; return }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); return }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
    e.preventDefault()
    const { currentUrl, resumeId, currentSiteLabel, safeHost } = useSidekick()
    if (currentUrl.value) {
      addToQueue({
        url: currentUrl.value,
        resumeId: resumeId.value || undefined,
        source: currentSiteLabel.value || safeHost(currentUrl.value) || 'страница',
        title: undefined,
      })
    }
    return
  }
  if (mod && e.key === '\\') { e.preventDefault(); selectView(activeView.value); return }
  if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); shortcutsOpen.value = !shortcutsOpen.value; return }
  if (e.key === 'Escape') { shortcutsOpen.value = false; return }
if (mod && /^[1-8]$/.test(e.key)) {
  e.preventDefault()
  const ids = ['chat', 'sourcing', 'screening', 'telegram', 'outreach', 'pipeline', 'library', 'hub'] as const
  const idx = Number(e.key) - 1
   if (idx < ids.length) selectView(ids[idx])
   return
 }
if (e.key === 'Escape' && paletteOpen.value) { e.preventDefault(); paletteOpen.value = false }
if (mod && e.key === ',') { e.preventDefault(); settingsOpen.value = !settingsOpen.value; return }
  if (e.key === 'Escape' && settingsOpen.value) { e.preventDefault(); settingsOpen.value = false }
}

/** Обработка смены URL активной вкладки — инъекция FAB. */
function onTabUrlChanged(msg: any) {
  if (msg?.type === 'tabUrlChanged' && msg?.tabId && msg?.url) {
    injectFab(msg.tabId, msg.url)
  }
}

/** Обработка действий от FAB на странице. */
function onFabAction(msg: any) {
  if (msg?.type !== 'fabAction') return
  const action = msg.action
  if (action === 'capture' || action === 'summary' || action === 'verify') {
    selectView(action === 'verify' ? 'screening' : 'sourcing')
  } else if (action === 'queue') {
    const { currentUrl, resumeId, currentSiteLabel, safeHost } = useSidekick()
    if (currentUrl.value) {
      addToQueue({
        url: currentUrl.value,
        resumeId: resumeId.value || undefined,
        source: currentSiteLabel.value || safeHost(currentUrl.value) || 'страница',
        title: undefined,
      })
    }
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  chrome.runtime?.onMessage?.addListener(onTabUrlChanged)
  chrome.runtime?.onMessage?.addListener(onFabAction)
  await loadTheme()
  await loadReducedMotion()
  await loadHistory()
  await loadFab()
  await init()
  // Инъекция FAB при открытии панели (не только при смене URL)
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tabs[0]?.id && tabs[0]?.url) {
      injectFab(tabs[0].id, tabs[0].url)
    }
  } catch {}
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  chrome.runtime?.onMessage?.removeListener(onTabUrlChanged)
  chrome.runtime?.onMessage?.removeListener(onFabAction)
})
</script>

<template>
  <PanelShell ref="viewportEl" @nav="selectView($event as any)">
    <template #topbar>
      <TopBar @settings="settingsOpen = true" @shortcuts="shortcutsOpen = true" />
    </template>
    <template #banner>
      <div v-if="!online" class="offline-banner hf-banner-in">Нет соединения с интернетом</div>
    </template>

    <div class="hf-view-viewport" :style="{ '--dir': direction }">
      <Transition
        mode="out-in"
        :css="false"
        @enter="onViewEnter"
        @leave="onViewLeave"
      >
        <ChatView v-if="currentView === 'chat'" key="chat" />
        <HubView v-else-if="currentView === 'hub'" key="hub" />
        <SourcingView v-else-if="currentView === 'sourcing'" key="sourcing" />
        <ScreeningView v-else-if="currentView === 'screening'" key="screening" />
        <TelegramView v-else-if="currentView === 'telegram'" key="telegram" />
        <OutreachView v-else-if="currentView === 'outreach'" key="outreach" />
        <PipelineView v-else-if="currentView === 'pipeline'" key="pipeline" />
        <LibraryView v-else-if="currentView === 'library'" key="library" />
        <ChatView v-else key="chat-fallback" />
      </Transition>
    </div>
  </PanelShell>

  <CommandPalette :open="paletteOpen" @close="paletteOpen = false" />
  <SettingsView v-if="settingsOpen" @close="settingsOpen = false" />
  <Toaster />
  <ShortcutsOverlay :open="shortcutsOpen" @close="shortcutsOpen = false" />
</template>

<style scoped>
/* Контейнер переключения views: relative для absolute уходящего вида. */
.hf-view-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.hf-view-viewport > :deep(*) {
  flex: 1;
  min-height: 0;
}
</style>
