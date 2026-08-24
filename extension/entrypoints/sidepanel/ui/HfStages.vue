<script setup lang="ts">
/**
 * П6: индикатор этапов генерации «Читаю страницу → Думаю → Пишу»
 * с секундомером. Пройденные этапы отмечаются галочкой, активный
 * подсвечен и пульсирует. Монтируется только на время генерации.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{ stage: 'read' | 'think' | 'write' }>()

const STAGES = [
  { id: 'read', label: 'Читаю страницу' },
  { id: 'think', label: 'Думаю' },
  { id: 'write', label: 'Пишу' },
] as const

const activeIdx = computed(() => STAGES.findIndex(s => s.id === props.stage))

const elapsedMs = ref(0)
let timerId: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  const t0 = Date.now()
  timerId = setInterval(() => { elapsedMs.value = Date.now() - t0 }, 100)
})
onUnmounted(() => {
  if (timerId) { clearInterval(timerId); timerId = null }
})

const elapsedLabel = computed(() => `${(elapsedMs.value / 1000).toFixed(1).replace('.', ',')} с`)
</script>

<template>
  <div class="hf-stages" role="status" aria-live="polite">
    <div class="hf-stages-track">
      <template v-for="(s, i) in STAGES" :key="s.id">
        <span v-if="i > 0" class="hf-stage-sep" aria-hidden="true">→</span>
        <span
          class="hf-stage"
          :class="{ 'is-done': i < activeIdx, 'is-active': i === activeIdx }"
        >
          <span class="hf-stage-dot" aria-hidden="true">
            <svg v-if="i < activeIdx" viewBox="0 0 12 12" width="10" height="10">
              <path d="M2.5 6.5 5 9l4.5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          {{ s.label }}
        </span>
      </template>
    </div>
    <span class="hf-stages-timer">{{ elapsedLabel }}</span>
  </div>
</template>

<style scoped>
.hf-stages {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-s-3);
  padding: var(--hf-s-2) var(--hf-s-3);
  background: var(--hf-surface-raised);
  border-radius: var(--hf-r-md);
}
.hf-stages-track {
  display: flex;
  align-items: center;
  gap: var(--hf-s-2);
  flex-wrap: wrap;
  min-width: 0;
}
.hf-stage {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-subtle);
  white-space: nowrap;
  transition: color 0.2s ease;
}
.hf-stage.is-done { color: var(--hf-fg-muted); }
.hf-stage.is-active { color: var(--hf-fg); font-weight: var(--hf-fw-semibold); }
.hf-stage-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  flex: none;
}
.hf-stage.is-done .hf-stage-dot { border-color: transparent; }
.hf-stage.is-active .hf-stage-dot {
  border-color: var(--hf-primary);
  background: var(--hf-primary);
  animation: hf-stage-pulse 1.2s ease-in-out infinite;
}
.hf-stage-sep { color: var(--hf-fg-subtle); font-size: var(--hf-t-xs); }
.hf-stages-timer {
  flex: none;
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
  font-variant-numeric: tabular-nums;
}
@keyframes hf-stage-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.8); }
}
@media (prefers-reduced-motion: reduce) {
  .hf-stage.is-active .hf-stage-dot { animation: none; }
}
</style>
