<script setup lang="ts">
/** AmbientBar — тонкая цветная полоса в TopBar.
 *  Появляется с задержкой ~400мс, без модалок. Hover → тултип-сводка. */
import { computed, ref, onMounted, watch } from 'vue'
import { useAmbient, type AmbientTone } from '../composables/useAmbient'
import { useReducedMotion } from '../composables/useTheme'

const { ambient } = useAmbient()
const { systemPrefers, reducedMotionOverride } = useReducedMotion()
const effectiveReduced = computed(() => reducedMotionOverride.value ?? systemPrefers.value)

/** Задержка появления — чтобы не дёргалось при быстрой смене вкладок. */
const shown = ref(false)
let showTimer: ReturnType<typeof setTimeout> | null = null

function armShow() {
  if (showTimer) clearTimeout(showTimer)
  if (effectiveReduced.value) { shown.value = true; return }
  shown.value = false
  showTimer = setTimeout(() => { shown.value = true }, 400)
}
function disarmShow() {
  if (showTimer) { clearTimeout(showTimer); showTimer = null }
  shown.value = false
}

onMounted(() => {
  // Реагируем на появление/исчезновение кандидата.
  watch(ambient, (v) => { v.visible ? armShow() : disarmShow() }, { immediate: true })
})


const toneClass = computed(() => `ambient-bar--${ambient.value.tone}`)
const tooltipOpen = ref(false)
</script>

<template>
  <Transition name="ambient">
    <div
      v-if="ambient.visible"
      class="ambient-bar"
      :class="[toneClass, { 'ambient-bar--shown': shown }]"
      role="status"
      :aria-label="ambient.summary"
      @mouseenter="tooltipOpen = true"
      @mouseleave="tooltipOpen = false"
    >
      <Transition name="ambient-tip">
        <div v-if="tooltipOpen" class="ambient-tip">
          <p class="ambient-tip-summary">{{ ambient.summary }}</p>
          <ul v-if="ambient.events.length" class="ambient-tip-events">
            <li v-for="(e, i) in ambient.events" :key="i" class="ambient-tip-event">
              <span class="ambient-tip-when">{{ e.when }}</span>
              <span class="ambient-tip-what">{{ e.what }}<template v-if="e.stage"> · {{ e.stage }}</template></span>
              <span v-if="e.reason" class="ambient-tip-reason">{{ e.reason }}</span>
            </li>
          </ul>
          <div v-if="ambient.matchedOn.length" class="ambient-tip-matched">
            <span class="ambient-tip-matched-label">Совпадение:</span>
            <span v-for="m in ambient.matchedOn" :key="m" class="ambient-tip-chip">{{ m }}</span>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.ambient-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 3px;
  opacity: 0;
  transform: scaleX(0.3);
  transform-origin: left center;
  transition:
    opacity var(--hf-dur-base) var(--hf-ease-out),
    transform var(--spring-snappy-dur) var(--spring-snappy);
  z-index: 5;
}
.ambient-bar--shown {
  opacity: 1;
  transform: scaleX(1);
}
.ambient-bar--high { background: var(--hf-warn); }
.ambient-bar--mid  { background: var(--hf-primary); }
.ambient-bar--low  { background: var(--hf-fg-subtle); }

/* Тултип */
.ambient-tip {
  position: absolute;
  top: calc(100% + 8px);
  left: var(--hf-s-4);
  max-width: 320px;
  padding: var(--hf-s-3);
  background: var(--hf-surface-raised);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  box-shadow: var(--hf-shadow-md);
  z-index: 50;
}
.ambient-tip-summary {
  font-size: var(--hf-t-sm);
  font-weight: var(--hf-fw-medium);
  color: var(--hf-fg);
  margin-bottom: var(--hf-s-2);
}
.ambient-tip-events {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--hf-s-2);
  display: flex;
  flex-direction: column;
  gap: var(--hf-s-1);
}
.ambient-tip-event {
  display: flex;
  align-items: baseline;
  gap: var(--hf-s-2);
  font-size: var(--hf-t-xs);
}
.ambient-tip-when { color: var(--hf-fg-subtle); flex-shrink: 0; min-width: 90px; }
.ambient-tip-what { color: var(--hf-fg-muted); }
.ambient-tip-reason { color: var(--hf-warn); }
.ambient-tip-matched {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--hf-s-1);
}
.ambient-tip-matched-label { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.ambient-tip-chip {
  font-size: var(--hf-t-xs);
  padding: 1px 6px;
  border-radius: var(--hf-r-pill);
  background: var(--hf-primary-muted);
  color: var(--hf-primary);
}

.ambient-enter-active, .ambient-leave-active {
  transition: opacity var(--hf-dur-fast) var(--hf-ease-out);
}
.ambient-enter-from, .ambient-leave-to { opacity: 0; }

.ambient-tip-enter-active, .ambient-tip-leave-active {
  transition: opacity var(--hf-dur-fast) var(--hf-ease-out), transform var(--hf-dur-fast) var(--hf-ease-out);
}
.ambient-tip-enter-from, .ambient-tip-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .ambient-bar { transition-duration: 0.01ms !important; transform: none !important; opacity: 1 !important; }
}
</style>
