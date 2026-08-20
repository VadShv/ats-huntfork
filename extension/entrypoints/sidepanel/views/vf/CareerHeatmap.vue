<!--
  CareerHeatmap.vue — тепловая карта карьеры.
  ТЗ «Фирменные детали» §1. Где: Верификация → Таймлайн.

  Полоса каждого места работы окрашивается по длительности через светлоту:
  короткие — тёмные и тревожные, долгие — светлые и спокойные.
  Логарифмическая нормализация: разница 3↔9 мес критична, 60↔66 — нет.
  Монохром: хрома 0.003, плотность штриховки через heatHatch().

  Дополнительные слои: пересечения — диагональная штриховка,
  пробелы — пунктир, текущее место — растворение правого края.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  heatFromMonths,
  heatColor,
  heatHatch,
  heatLabel,
} from '../../fx/signature'
import type { JobPeriod, TimelineFinding } from '../../composables/useVerification'

const props = defineProps<{
  periods: JobPeriod[]
  findings?: TimelineFinding[]
}>()

const showLegend = ref(false)

// Нормализация для ширины полос: относительные позиции 0..100
const span = computed(() => {
  if (!props.periods.length) return { start: 0, end: 1 }
  const start = Math.min(...props.periods.map((p) => p.start))
  const end = Math.max(...props.periods.map((p) => p.end))
  return { start, end: end === start ? start + 1 : end }
})

interface HeatBar {
  period: JobPeriod
  leftPct: number
  widthPct: number
  color: string
  heat: number
  hatch: number
  label: string
  isCurrent: boolean
  hasIntersection: boolean
}

const bars = computed<HeatBar[]>(() => {
  const s = span.value
  return props.periods.map((p, i) => {
    const leftPct = ((p.start - s.start) / (s.end - s.start)) * 100
    const widthPct = ((p.end - p.start) / (s.end - s.start)) * 100
    const heat = heatFromMonths(p.durationMonths)
    const isCurrent = p.endRaw === null
    const hasIntersection = (props.findings || []).some(
      (f) => f.kind === 'intersection' && (f.companyA === p.company || f.companyB === p.company),
    )
    return {
      period: p,
      leftPct: Math.max(0, leftPct),
      widthPct: Math.max(2, widthPct),
      color: heatColor(p.durationMonths),
      heat,
      hatch: heatHatch(p.durationMonths),
      label: heatLabel(p.durationMonths),
      isCurrent,
      hasIntersection,
    }
  })
})

// Пробелы между периодами (для пунктирных линий)
interface Gap {
  leftPct: number
  widthPct: number
}

const gaps = computed<Gap[]>(() => {
  const s = span.value
  const sorted = [...props.periods].sort((a, b) => a.start - b.start)
  const result: Gap[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (curr.start > prev.end) {
      const leftPct = ((prev.end - s.start) / (s.end - s.start)) * 100
      const widthPct = ((curr.start - prev.end) / (s.end - s.start)) * 100
      result.push({ leftPct, widthPct: Math.max(0.5, widthPct) })
    }
  }
  return result
})

const avgTenure = computed(() => {
  if (!props.periods.length) return 0
  return Math.round(
    props.periods.reduce((sum, p) => sum + p.durationMonths, 0) / props.periods.length,
  )
})
</script>

<template>
  <div class="heatmap" v-if="periods.length">
    <div class="heatmap__head">
      <span class="heatmap__title">Карта карьеры</span>
      <button
        class="heatmap__legend-toggle"
        :class="{ 'is-open': showLegend }"
        @click="showLegend = !showLegend"
      >
        Шкала
      </button>
    </div>

    <!-- Полосы -->
    <div class="heatmap__track">
      <!-- Пробелы (пунктир) -->
      <div
        v-for="(gap, i) in gaps"
        :key="'gap-' + i"
        class="heatmap__gap"
        :style="{ left: gap.leftPct + '%', width: gap.widthPct + '%' }"
      />

      <!-- Полосы мест работы -->
      <div
        v-for="(bar, i) in bars"
        :key="bar.period.company + i"
        class="heatmap__bar"
        :class="{
          'is-current': bar.isCurrent,
          'has-intersection': bar.hasIntersection,
        }"
        :style="{
          left: bar.leftPct + '%',
          width: bar.widthPct + '%',
         '--bar-color': bar.color,
          '--bar-hatch': bar.hatch + 'px',
          '--hf-i': Math.min(i, 7),
        }"
        :title="`${bar.period.company} · ${bar.period.durationMonths} мес · ${bar.label}`"
      >
        <span v-if="bar.widthPct > 12" class="heatmap__bar-label">
          {{ bar.period.durationMonths }} мес
        </span>
      </div>
    </div>

    <!-- Легенда -->
    <Transition name="hf-grid">
      <div v-if="showLegend" class="heatmap__legend">
        <div class="heatmap__legend-scale">
          <div class="heatmap__legend-stop" style="--bar-color: #1A1A1C">
            <span class="heatmap__legend-dot" />
            <span>2 мес</span>
            <span class="heatmap__legend-note">Тревожно</span>
          </div>
          <div class="heatmap__legend-stop" style="--bar-color: #6A6A6E">
            <span class="heatmap__legend-dot" />
            <span>12 мес</span>
            <span class="heatmap__legend-note">Нейтрально</span>
          </div>
          <div class="heatmap__legend-stop" style="--bar-color: #9E9EA2">
            <span class="heatmap__legend-dot" />
            <span>24 мес</span>
            <span class="heatmap__legend-note">Спокойно</span>
          </div>
          <div class="heatmap__legend-stop" style="--bar-color: #CDCDCF">
            <span class="heatmap__legend-dot" />
            <span>≥ 60 мес</span>
            <span class="heatmap__legend-note">Якорь</span>
          </div>
        </div>
        <p class="heatmap__caveat">
          Шкала не является оценкой. Короткий срок может быть проектной работой,
          закрытием компании или испытательным сроком по чужой вине.
        </p>
      </div>
    </Transition>

    <div class="heatmap__meta">
      <span>Средний срок: {{ avgTenure }} мес</span>
      <span>{{ periods.length }} мест</span>
    </div>
  </div>
</template>

<style scoped>
.heatmap {
  display: flex;
  flex-direction: column;
  gap: var(--hf-s-2);
  padding: var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface);
}

.heatmap__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.heatmap__title {
  font-size: var(--hf-t-sm);
  font-weight: var(--hf-fw-semibold);
  color: var(--hf-fg);
}

.heatmap__legend-toggle {
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
  background: none;
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-pill);
  padding: 2px 8px;
  cursor: pointer;
  transition: background var(--hf-dur-instant) var(--hf-ease-out);
}

.heatmap__legend-toggle:hover {
  background: var(--hf-surface-sunken);
}

.heatmap__track {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 56px;
}

.heatmap__bar {
  position: relative;
  height: 18px;
  border-radius: var(--hf-r-sm);
  background:
    repeating-linear-gradient(
      135deg,
      transparent 0,
      transparent calc(var(--bar-hatch, 6px) - 1px),
      rgba(255,255,255,0.18) calc(var(--bar-hatch, 6px) - 1px),
      rgba(255,255,255,0.18) var(--bar-hatch, 6px)
    ),
    var(--bar-color);
  border: 1px solid var(--hf-border-strong);
  transform-origin: left;
  animation: heat-grow var(--hf-dur-base) var(--hf-ease-out) both;
  animation-delay: calc(var(--hf-i, 0) * 35ms);
  overflow: hidden;
}

@keyframes heat-grow {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

.heatmap__bar-label {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 10px;
  font-family: var(--hf-mono);
  font-weight: var(--hf-fw-semibold);
  color: var(--hf-fg-on-accent);
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

/* Текущее место — правый край растворяется. */
.heatmap__bar.is-current::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 24px;
  background: linear-gradient(
    to right,
    transparent,
    var(--hf-surface) 100%
  );
  pointer-events: none;
}

/* Пересечения — диагональная штриховка. */
.heatmap__bar.has-intersection {
  background-image: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 3px,
    var(--hf-match-mid) 3px,
    var(--hf-match-mid) 5px
  );
}

/* Пробелы — пунктир. */
.heatmap__gap {
  position: absolute;
  top: 0;
  height: 100%;
  border-left: 1px dashed var(--hf-border-strong);
  border-right: 1px dashed var(--hf-border-strong);
  background: var(--hf-surface-sunken);
  opacity: 0.5;
  border-radius: 2px;
}

.heatmap__legend {
  padding: var(--hf-s-2);
  border-top: 1px solid var(--hf-border);
}

.heatmap__legend-scale {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--hf-s-2);
}

.heatmap__legend-stop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
}

.heatmap__legend-dot {
  width: 100%;
  height: 6px;
  border-radius: var(--hf-r-pill);
  background: var(--bar-color);
  margin-bottom: 2px;
}

.heatmap__legend-note {
  font-size: 10px;
  color: var(--hf-fg-subtle);
}

.heatmap__caveat {
  margin: var(--hf-s-2) 0 0;
  font-size: 10px;
  color: var(--hf-fg-subtle);
  line-height: 1.4;
}

.heatmap__meta {
  display: flex;
  justify-content: space-between;
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  .heatmap__bar {
    animation: none !important;
  }
}
</style>
