<script setup lang="ts">
/** SmCapacity — блок «Оценка ёмкости рынка» (блок 6.2).
 *  Горизонтальная шкала: просмотрено / в работе / не тронуто.
 *  Отвечает на вопрос «почему так долго?». */
import { computed } from 'vue'
import { useSearchMap } from '../../composables/useSearchMap'

const { capacity } = useSearchMap()

const segments = computed(() => capacity.value.segments)
const total = computed(() => capacity.value.total)
const touchedPct = computed(() => {
  const viewed = segments.value[0]?.value || 0
  const inProg = segments.value[1]?.value || 0
  return total.value ? Math.round(((viewed + inProg) / total.value) * 100) : 0
})
</script>

<template>
  <div class="sm-capacity">
    <div class="sm-cap-total">
      <span class="sm-cap-total-num">{{ total.toLocaleString('ru-RU') }}</span>
      <span class="sm-cap-total-label">специалистов в принципе существует</span>
    </div>

    <div class="sm-cap-bar" role="img" :aria-label="`Просмотрено ${touchedPct}% базы`">
      <div
        v-for="(seg, i) in segments"
        :key="seg.label"
        class="sm-cap-seg"
        :class="`sm-cap-seg--${seg.tone}`"
        :style="{ width: (seg.value / total * 100) + '%', '--hf-i': i }"
      >
        <span v-if="seg.value / total > 0.08" class="sm-cap-seg-pct">{{ Math.round(seg.value / total * 100) }}%</span>
      </div>
    </div>

    <div class="sm-cap-legend">
      <div v-for="seg in segments" :key="seg.label" class="sm-cap-legend-item">
        <span class="sm-cap-dot" :class="`sm-cap-dot--${seg.tone}`" />
        <span class="sm-cap-legend-label">{{ seg.label }}</span>
        <span class="sm-cap-legend-val">{{ seg.value.toLocaleString('ru-RU') }}</span>
      </div>
    </div>

    <p class="sm-cap-hint">Просмотрено уже <strong>{{ touchedPct }}%</strong> рынка. Осталось untouched — {{ ((segments[2]?.value || 0)).toLocaleString('ru-RU') }}.</p>
  </div>
</template>

<style scoped>
.sm-capacity { padding: var(--hf-s-2) 0; }
.sm-cap-total { margin-bottom: var(--hf-s-3); }
.sm-cap-total-num { font-size: var(--hf-t-xl); font-weight: var(--hf-fw-bold); color: var(--hf-fg); }
.sm-cap-total-label { display: block; font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }

.sm-cap-bar { display: flex; width: 100%; height: 22px; border-radius: var(--hf-r-pill); overflow: hidden; background: var(--hf-surface-sunken); }
.sm-cap-seg {
  display: flex; align-items: center; justify-content: center;
  height: 100%;
  color: var(--hf-fg-on-accent);
  font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold);
  transition: width var(--spring-gentle-dur) var(--spring-gentle);
  opacity: 0;
  animation: hf-cap-in var(--hf-dur-base) var(--hf-ease-out) forwards;
  animation-delay: calc(var(--hf-i, 0) * 90ms);
  min-width: 2px;
}
@keyframes hf-cap-in { to { opacity: 1; } }
.sm-cap-seg--high { background: var(--hf-match-high); }
.sm-cap-seg--mid { background: var(--hf-match-mid); }
.sm-cap-seg--low { background: var(--hf-fg-subtle); }
.sm-cap-seg-pct { white-space: nowrap; }

.sm-cap-legend { display: flex; flex-wrap: wrap; gap: var(--hf-s-3); margin-top: var(--hf-s-3); }
.sm-cap-legend-item { display: flex; align-items: center; gap: var(--hf-s-1); font-size: var(--hf-t-xs); }
.sm-cap-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sm-cap-dot--high { background: var(--hf-match-high); }
.sm-cap-dot--mid { background: var(--hf-match-mid); }
.sm-cap-dot--low { background: var(--hf-fg-subtle); }
.sm-cap-legend-label { color: var(--hf-fg-muted); }
.sm-cap-legend-val { color: var(--hf-fg); font-weight: var(--hf-fw-semibold); }

.sm-cap-hint { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); line-height: var(--hf-lh-normal); margin: var(--hf-s-3) 0 0; }
.sm-cap-hint strong { color: var(--hf-fg); }
@media (prefers-reduced-motion: reduce) { .sm-cap-seg { animation: none !important; } }
</style>
