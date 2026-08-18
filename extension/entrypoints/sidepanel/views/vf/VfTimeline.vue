<script setup lang="ts">
/** VfTimeline — Блок А. Анализ таймлайна (реальный расчёт).
 *  Диаграмма Ганта: позиции полосами, пересечения штриховкой, пробелы пунктиром.
 *  Тултипы с длительностью в месяцах. Производные метрики. */
import { ref, computed } from 'vue'
import HfIcon from '../../ui/HfIcon.vue'
import CareerHeatmap from './CareerHeatmap.vue'
import { useVerification } from '../../composables/useVerification'
import type { TimelineFinding } from '../../composables/useVerification'

const { timeline } = useVerification()

const hovered = ref<string | null>(null)

const LEVEL_LABEL: Record<string, string> = {
  high: 'высокий', mid: 'средний', low: 'низкий', info: 'информационный',
}

// Нормализация для диаграммы Ганта: относительные позиции 0..100
const span = computed(() => {
  if (!timeline.value.periods.length) return { start: 0, end: 1 }
  const start = Math.min(...timeline.value.periods.map(p => p.start))
  const end = Math.max(...timeline.value.periods.map(p => p.end))
  return { start, end: end === start ? start + 1 : end }
})

function pct(ms: number): number {
  const s = span.value
  return ((ms - s.start) / (s.end - s.start)) * 100
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })
}

function isIntersection(f: TimelineFinding): boolean {
  return f.kind === 'intersection'
}
</script>

<template>
  <div class="vf-tl">
    <!-- Производные метрики -->
    <div class="vf-tl-metrics">
      <div class="vf-tl-metric">
        <span class="vf-tl-metric-num hf-num">{{ timeline.calendarSpanMonths }}</span>
        <span class="vf-tl-metric-lbl">календарный охват, мес</span>
      </div>
      <div class="vf-tl-metric">
        <span class="vf-tl-metric-num hf-num">{{ timeline.actualExperienceMonths }}</span>
        <span class="vf-tl-metric-lbl">сумма периодов, мес</span>
      </div>
      <div class="vf-tl-metric" :class="{ 'vf-tl-metric--warn': timeline.inflationMonths > 0 }">
        <span class="vf-tl-metric-num hf-num">{{ timeline.inflationMonths }}</span>
        <span class="vf-tl-metric-lbl">инфляция стажа, мес</span>
      </div>
    </div>

    <!-- Диаграмма Ганта -->
    <div v-if="timeline.periods.length" class="vf-tl-gantt">
      <CareerHeatmap
        v-if="timeline.periods.length"
        :periods="timeline.periods"
        :findings="timeline.findings"
      />
      <div
        v-for="(p, i) in timeline.periods"
        :key="i"
        class="vf-tl-row"
        @mouseenter="hovered = `p${i}`"
        @mouseleave="hovered = null"
      >
        <div class="vf-tl-company" :title="p.company">{{ p.company }}</div>
        <div class="vf-tl-track">
          <div
            class="vf-tl-bar"
            :style="{ left: pct(p.start) + '%', width: (pct(p.end) - pct(p.start)) + '%' }"
            :class="{ 'vf-tl-bar--open': p.endRaw === null || /настоящ|now|текущ/i.test(String(p.endRaw)) }"
          >
            <span class="vf-tl-bar-title">{{ p.title }}</span>
          </div>
        </div>
        <div class="vf-tl-dur">{{ p.durationMonths }} мес</div>

        <Transition name="vf-pop">
          <div v-if="hovered === `p${i}`" class="vf-tl-tip">
            <strong>{{ p.company }}</strong>
            <span>{{ p.title || '—' }}</span>
            <span>{{ fmtDate(p.start) }} — {{ p.endRaw === null || /настоящ|now|текущ/i.test(String(p.endRaw)) ? 'настоящее' : fmtDate(p.end) }}</span>
            <span>{{ p.durationMonths }} мес · {{ p.isFulltime ? 'фултайм' : 'не фултайм' }}</span>
          </div>
        </Transition>
      </div>

      <!-- Слой пересечений -->
      <div class="vf-tl-overlaps">
        <div
          v-for="f in timeline.findings.filter(isIntersection)"
          :key="f.id"
          class="vf-tl-overlap"
          :class="`vf-tl-overlap--${f.level}`"
          :title="f.detail"
        />
      </div>
    </div>

    <!-- Находки -->
    <div v-if="timeline.findings.length" class="vf-tl-findings">
      <div
        v-for="(f, i) in timeline.findings"
        :key="f.id"
        class="vf-tl-find hf-cascade"
        :class="`vf-tl-find--${f.level}`"
        :style="{ '--hf-i': Math.min(i, 7) }"
      >
        <span class="vf-tl-find-dot" />
        <div class="vf-tl-find-main">
          <div class="vf-tl-find-detail">{{ f.detail }}</div>
          <div class="vf-tl-find-alt">
            <HfIcon name="history" :size="11" />
            <span>Альтернатива: {{ f.alternativeExplanation }}</span>
          </div>
        </div>
        <span class="vf-tl-find-level">{{ LEVEL_LABEL[f.level] }}</span>
      </div>
    </div>
    <div v-else-if="timeline.periods.length" class="vf-tl-clean">
      <HfIcon name="check" :size="14" /> Пересечений и пробелов &gt; 2 мес не найдено
    </div>
    <div v-else class="vf-tl-clean">
      <HfIcon name="alert" :size="14" /> Опыт не распознан — данных для таймлайна недостаточно
    </div>
  </div>
</template>

<style scoped>
.vf-tl { display: flex; flex-direction: column; gap: var(--hf-s-3); }

.vf-tl-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--hf-s-2); }
.vf-tl-metric { display: flex; flex-direction: column; gap: 1px; padding: var(--hf-s-2) var(--hf-s-3); border-radius: var(--hf-r-md); background: var(--hf-surface-sunken); }
.vf-tl-metric--warn { background: var(--hf-match-mid-muted); }
.vf-tl-metric-num { font-size: var(--hf-t-lg); font-weight: var(--hf-fw-bold); color: var(--hf-fg); font-family: var(--hf-mono); }
.vf-tl-metric--warn .vf-tl-metric-num { color: var(--hf-match-mid); }
.vf-tl-metric-lbl { font-size: 10px; color: var(--hf-fg-subtle); text-transform: uppercase; letter-spacing: 0.03em; }

.vf-tl-gantt { display: flex; flex-direction: column; gap: 2px; position: relative; padding: var(--hf-s-2) 0; }
.vf-tl-row { display: grid; grid-template-columns: 90px 1fr 48px; gap: var(--hf-s-2); align-items: center; position: relative; }
.vf-tl-company { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vf-tl-track { position: relative; height: 22px; background: var(--hf-surface-sunken); border-radius: var(--hf-r-sm); overflow: hidden; }
.vf-tl-bar { position: absolute; top: 2px; bottom: 2px; display: flex; align-items: center; padding: 0 var(--hf-s-2); border-radius: var(--hf-r-sm); background: var(--hf-primary-muted); border: 1px solid var(--hf-primary); min-width: 4px; }
.vf-tl-bar--open { border-style: dashed; }
.vf-tl-bar-title { font-size: 10px; color: var(--hf-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vf-tl-dur { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); font-family: var(--hf-mono); text-align: right; }

.vf-tl-tip { position: absolute; z-index: 20; left: 96px; top: 100%; display: grid; gap: 1px; padding: var(--hf-s-2); border-radius: var(--hf-r-md); background: var(--hf-surface-raised); box-shadow: var(--hf-shadow-lg); border: 1px solid var(--hf-border); font-size: var(--hf-t-xs); color: var(--hf-fg); pointer-events: none; }
.vf-tl-tip strong { color: var(--hf-fg); }

.vf-tl-findings { display: flex; flex-direction: column; gap: var(--hf-s-1); }
.vf-tl-find { display: grid; grid-template-columns: 8px 1fr auto; gap: var(--hf-s-2); align-items: start; padding: var(--hf-s-2) var(--hf-s-3); border-radius: var(--hf-r-md); background: var(--hf-surface); border: 1px solid var(--hf-border); border-left-width: 3px; }
.vf-tl-find--high { border-left-color: var(--hf-match-low); }
.vf-tl-find--mid { border-left-color: var(--hf-match-mid); }
.vf-tl-find--low { border-left-color: var(--hf-fg-subtle); }
.vf-tl-find--info { border-left-color: var(--hf-info); }
.vf-tl-find-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; }
.vf-tl-find--high .vf-tl-find-dot { background: var(--hf-match-low); }
.vf-tl-find--mid .vf-tl-find-dot { background: var(--hf-match-mid); }
.vf-tl-find--low .vf-tl-find-dot { background: var(--hf-fg-subtle); }
.vf-tl-find--info .vf-tl-find-dot { background: var(--hf-info); }
.vf-tl-find-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vf-tl-find-detail { font-size: var(--hf-t-sm); color: var(--hf-fg); }
.vf-tl-find-alt { display: flex; align-items: center; gap: 4px; font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }
.vf-tl-find-level { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); white-space: nowrap; }

.vf-tl-clean { display: flex; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-3); color: var(--hf-fg-muted); font-size: var(--hf-t-sm); }

.vf-pop-enter-active, .vf-pop-leave-active { transition: opacity var(--hf-dur-fast) var(--hf-ease-out); }
.vf-pop-enter-from, .vf-pop-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) { .vf-tl-find { animation: none !important; } }
</style>
