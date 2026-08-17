<script setup lang="ts">
import { computed } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import { useSidekick } from '../composables/useSidekick'
import { useTheme, useReducedMotion } from '../composables/useTheme'
import AmbientBar from './AmbientBar.vue'

const { sessionUser, currentUrl, safeHost, currentSiteLabel, isHhPage } = useSidekick()
const emit = defineEmits<{ settings: [], shortcuts: [] }>()
const { theme, toggle } = useTheme()
const { systemPrefers, reducedMotionOverride, setOverride } = useReducedMotion()

const effectiveReduced = computed(() => reducedMotionOverride.value ?? systemPrefers.value)

/** Перекрывает системную настройку анимаций. */
function toggleReduced() {
  setOverride(!effectiveReduced.value)
}

const hostLabel = computed(() => {
  if (!currentUrl.value) return 'Нет активной вкладки'
  return safeHost(currentUrl.value) || '—'
})
</script>

<template>
  <header class="topbar">
    <AmbientBar />
    <div class="topbar-ctx">
      <div class="topbar-host">
        <span class="topbar-dot" :class="{ 'topbar-dot--hh': isHhPage }" />
        <span class="topbar-host-name" :title="currentUrl ?? ''">{{ hostLabel }}</span>
      </div>
      <span v-if="currentSiteLabel && !isHhPage" class="topbar-site">{{ currentSiteLabel }}</span>
    </div>

    <div class="topbar-actions">
      <span v-if="sessionUser" class="topbar-user" :title="sessionUser.email">
        {{ sessionUser.name || sessionUser.email || '—' }}
      </span>
     <button
       class="topbar-btn"
       :class="{ 'topbar-btn--on': effectiveReduced }"
       :title="effectiveReduced ? 'Включить анимации' : 'Уменьшить анимации'"
       aria-label="Уменьшить анимации"
       @click="toggleReduced"
     >
       <HfIcon name="sparkle" :size="18" />
     </button>
     <button
       class="topbar-btn"
        title="Горячие клавиши (?)"
        aria-label="Горячие клавиши"
        @click="emit('shortcuts')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
        </svg>
      </button>
      <button
        class="topbar-btn"
        title="Настройки"
        aria-label="Настройки"
        @click="emit('settings')"
      >
        <HfIcon name="settings" :size="18" />
      </button>
     <button
        class="topbar-btn"
        :class="{ 'topbar-btn--on': theme === 'dark' }"
        :title="theme === 'light' ? 'Тёмная тема' : 'Светлая тема'"
        aria-label="Переключить тему"
        @click="toggle"
      >
        <HfIcon :name="theme === 'light' ? 'moon' : 'sun'" :size="18" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--hf-topbar-h);
  padding: 0 var(--hf-s-4);
  background: var(--hf-surface);
  border-bottom: 1px solid var(--hf-border);
  flex-shrink: 0;
  position: relative;
}
.topbar-ctx { display: flex; align-items: center; gap: var(--hf-s-3); min-width: 0; }
.topbar-host { display: flex; align-items: center; gap: var(--hf-s-2); min-width: 0; }
.topbar-dot {
  width: 7px; height: 7px; border-radius: var(--hf-r-pill);
  background: var(--hf-fg-subtle); flex-shrink: 0;
}
.topbar-dot--hh { background: var(--hf-primary); }
.topbar-host-name {
  font-size: var(--hf-t-sm); font-weight: var(--hf-fw-medium); color: var(--hf-fg);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.topbar-site { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); flex-shrink: 0; }

.topbar-actions { display: flex; align-items: center; gap: var(--hf-s-2); flex-shrink: 0; }
.topbar-user {
  font-size: var(--hf-t-xs); color: var(--hf-fg-muted);
  max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.topbar-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: var(--hf-r-md);
  color: var(--hf-fg-muted);
  transition: background var(--hf-dur-fast) var(--hf-ease-out), color var(--hf-dur-fast) var(--hf-ease-out);
}
.topbar-btn:hover { background: var(--hf-surface-sunken); color: var(--hf-fg); }
.topbar-btn--on { color: var(--hf-primary); }
</style>
