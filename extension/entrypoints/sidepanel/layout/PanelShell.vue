<script setup lang="ts">
/** Обёртка панели: рельс + (топбар + viewport + композер). */
import { ref } from 'vue'
import RailNav from './RailNav.vue'
import { usePanelWidth } from '../composables/usePanelWidth'

const { railExpanded, panelWidth, MIN, MAX, load, setWidth } = usePanelWidth()
load()

const viewportEl = ref<HTMLElement | null>(null)
const dragging = ref(false)

/** Ресайз перетаскиванием левого края панели. */
function onDragStart(e: PointerEvent) {
  dragging.value = true
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}
function onDragMove(e: PointerEvent) {
  if (!dragging.value) return
  setWidth(window.innerWidth - e.clientX)
}
function onDragEnd(e: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
}

defineExpose({ viewportEl })
</script>

<template>
 <div class="shell" :style="{ width: panelWidth + 'px' }">
   <div
     class="resize-handle"
      :class="{ 'resize-handle--drag': dragging }"
      role="separator"
      aria-orientation="vertical"
      aria-label="Изменить ширину панели"
      tabindex="0"
      @pointerdown="onDragStart"
      @pointermove="onDragMove"
      @pointerup="onDragEnd"
      @pointercancel="onDragEnd"
    />
    <RailNav v-model:expanded="railExpanded" @select="$emit('nav', $event)" />
    <div class="shell-main">
      <slot name="topbar" />
      <div class="offline-banner" v-if="$slots.banner">
        <slot name="banner" />
      </div>
      <div ref="viewportEl" class="shell-viewport hf-scroll">
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
  height: 100%;
  overflow: hidden;
  position: relative;
}
.shell-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  position: relative;
  z-index: 1;
}
.shell-viewport {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
}
.resize-handle {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 5px;
  cursor: col-resize;
  z-index: 50;
  background: transparent;
  transition: background var(--hf-dur-fast) var(--hf-ease-out);
}
.resize-handle:hover, .resize-handle--drag { background: var(--hf-primary-muted); }
.resize-handle:focus-visible { outline: none; background: var(--hf-primary-muted); box-shadow: var(--hf-glow); }
</style>
