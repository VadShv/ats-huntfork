<script setup lang="ts">
/** Обёртка панели: рельс + (автоскрываемый топбар + viewport + композер).
    Ширина — всегда 100% окна side panel: реальную ширину задаёт браузер,
    пользователь тянет край самой боковой панели Chrome. */
import { ref } from 'vue'
import RailNav from './RailNav.vue'
import { usePanelWidth } from '../composables/usePanelWidth'

const { railExpanded, load, toggleRail } = usePanelWidth()
load()

const viewportEl = ref<HTMLElement | null>(null)

/** Топбар скрыт; появляется при наведении на верхнюю кромку или фокусе с клавиатуры. */
const topbarOpen = ref(false)
let closeTimer: ReturnType<typeof setTimeout> | null = null

function openTopbar() {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  topbarOpen.value = true
}
function closeTopbar() {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = setTimeout(() => { topbarOpen.value = false }, 240)
}

defineExpose({ viewportEl })
</script>

<template>
  <div class="shell">
    <RailNav :expanded="railExpanded" @update:expanded="toggleRail()" @select="$emit('nav', $event)" />
    <div class="shell-main">
      <div
        class="topbar-reveal"
        :class="{ 'topbar-reveal--open': topbarOpen }"
        @mouseenter="openTopbar"
        @mouseleave="closeTopbar"
        @focusin="openTopbar"
        @focusout="closeTopbar"
      >
        <div class="topbar-slot">
          <slot name="topbar" />
        </div>
        <div class="topbar-peek" aria-hidden="true">
          <span class="topbar-peek-line" />
        </div>
      </div>
      <slot name="banner" />
      <div ref="viewportEl" class="shell-viewport">
        <slot />
      </div>
      <slot name="composer" />
    </div>
  </div>
</template>

<script lang="ts">
export default { name: 'PanelShell' }
</script>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: auto 1fr;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}
.shell-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  /* grid-элемент: без этого контент распирает колонку выше окна и скролл ломается. */
  min-height: 0;
  height: 100%;
  position: relative;
  z-index: 1;
}
/* Viewport — flex-колонка: вью получают ограниченную высоту
   и честный внутренний скролл (min-height: 0 в цепочке обязателен). */
.shell-viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* ── Автоскрываемый топбар ────────────────────────────────────── */
.topbar-reveal {
  position: absolute;
  top: 0; left: 0; right: 0;
  z-index: 40;
  pointer-events: none;
}
.topbar-slot {
  position: absolute;
  top: 0; left: 0; right: 0;
  transform: translateY(-100%);
  transition: transform var(--hf-dur-base) var(--hf-ease-out),
              box-shadow var(--hf-dur-base) var(--hf-ease-out);
  pointer-events: auto;
  will-change: transform;
}
.topbar-reveal--open .topbar-slot {
  transform: translateY(0);
  box-shadow: var(--hf-shadow-md);
}
/* Кромка-приманка: тонкая полоска сверху, ловит наведение. */
.topbar-peek {
  height: 12px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  pointer-events: auto;
}
.topbar-peek-line {
  width: 44px;
  height: 4px;
  margin-top: 3px;
  border-radius: var(--hf-r-pill);
  background: var(--hf-border-strong);
  opacity: 0.55;
  transition: opacity var(--hf-dur-fast) var(--hf-ease-out),
              background var(--hf-dur-fast) var(--hf-ease-out);
}
.topbar-reveal:hover .topbar-peek-line { opacity: 1; background: var(--hf-primary); }
.topbar-reveal--open .topbar-peek { height: 0; overflow: hidden; }
</style>
