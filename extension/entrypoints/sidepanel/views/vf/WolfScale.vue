<!--
  Huntfork Sidekick — шкала «Волкодава».
  Реализует §3.3 и §5.2 ТЗ «Верификация данных и подсветка рисков».

  Волки зажигаются последовательно (90 мс), поповер раскрывает расшифровку.
  Оценка без расшифровки не показывается — это требование ТЗ, а не опция.
-->

<script setup lang="ts">
import { ref, computed, watch, onMounted, onScopeDispose, useTemplateRef } from 'vue'
import WolfHead from './WolfHead.vue'
import { useWolfEyes } from '../../fx/signature'

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type Confidence = 'document' | 'date_math' | 'cross_source' | 'linguistic' | 'ai_detection'

export interface Finding {
  id: string
  title: string
  severity: Severity
  confidence: Confidence
}

const props = withDefaults(defineProps<{
  findings: Finding[]
  /** Показывать шкалу. false — «Волкодав» не запускался. */
  active?: boolean
  /** Пропустить анимацию (при восстановлении из кэша). */
  instant?: boolean
}>(), { active: true, instant: false })

/* ── Модель расчёта (§3.3 ТЗ) ─────────────────────────────────── */
const WEIGHT: Record<Severity, number> = {
  critical: 5.0, high: 3.0, medium: 1.5, low: 0.5,
}

/* Низкие множители у лингвистики и ИИ-детекции — прямое следствие
   их ненадёжности. Это не тюнинг, а защита от ложных обвинений. */
const CONFIDENCE: Record<Confidence, number> = {
  document: 1.0,
  date_math: 0.95,
  cross_source: 0.9,
  linguistic: 0.5,
  ai_detection: 0.35,
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  document: 'факт из документа',
  date_math: 'арифметика по датам',
  cross_source: 'расхождение источников',
  linguistic: 'лингвистика',
  ai_detection: 'детекция ИИ',
}

/** Сигналы, считающиеся проверяемыми фактами. */
const HARD: Confidence[] = ['document', 'date_math', 'cross_source']

const NORM = 4.0

const rawScore = computed(() =>
  props.findings.reduce(
    (sum, f) => sum + WEIGHT[f.severity] * CONFIDENCE[f.confidence],
    0,
  ),
)

const hasHardEvidence = computed(() =>
  props.findings.some(f => HARD.includes(f.confidence)),
)

const uncapped = computed(() =>
  Math.max(1, Math.min(5, Math.round(rawScore.value / NORM) + 1)),
)

/**
 * Ключевое ограничение §3.3: ни лингвистика, ни детекция ИИ
 * в одиночку не поднимают оценку выше трёх волков. Четыре и пять
 * достижимы только при проверяемых фактических расхождениях.
 */
const isCapped = computed(() => !hasHardEvidence.value && uncapped.value > 3)

const score = computed(() => (isCapped.value ? 3 : uncapped.value))

const LEVELS = [
  { n: 1, name: 'Одинокий волк',        hint: 'Профиль чистый, единичные мелочи' },
  { n: 2, name: 'Волк насторожился',    hint: 'Есть что уточнить, ничего серьёзного' },
  { n: 3, name: 'Стая почуяла',         hint: 'Несколько существенных несостыковок' },
  { n: 4, name: 'Волки идут по следу',  hint: 'Системные противоречия' },
  { n: 5, name: 'Волкодав спущен',      hint: 'Критические расхождения' },
] as const

const level = computed(() => LEVELS[score.value - 1])

/** Вклад каждой находки, по убыванию — для расшифровки. */
const breakdown = computed(() =>
  props.findings
    .map(f => ({
      ...f,
      impact: WEIGHT[f.severity] * CONFIDENCE[f.confidence],
      confidenceLabel: CONFIDENCE_LABEL[f.confidence],
    }))
    .sort((a, b) => b.impact - a.impact),
)

/* ── Последовательное зажигание ───────────────────────────────── */
const lit = ref(0)
let timers: ReturnType<typeof setTimeout>[] = []

const reduced = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches

function ignite() {
  timers.forEach(clearTimeout)
  timers = []
  lit.value = 0

  if (!props.active) return
  if (props.instant || reduced) { lit.value = score.value; return }

  for (let i = 1; i <= score.value; i++) {
    timers.push(setTimeout(() => (lit.value = i), i * 90))
  }
}

onMounted(ignite)
watch([score, () => props.active], ignite)
onScopeDispose(() => timers.forEach(clearTimeout))

/* ── Поповер ──────────────────────────────────────────────────── */
const open = ref(false)

/* ── Слежение зрачков (§2 ТЗ «Фирменные детали») ─────────────── */
const wolfHost = useTemplateRef<HTMLElement>('wolfHost')
const { eyeStyle, blinking, activate, deactivate } = useWolfEyes(wolfHost)
</script>

<template>
  <div v-if="active" class="ws">
    <button
      class="ws__trigger"
      :class="{ 'hf-ring-spin': active && lit > 0 }"
      :aria-expanded="open"
      :aria-label="`Оценка: ${score} из 5 — ${level.name}`"
      @click="open = !open"
    >
      <span class="ws__wolves" aria-hidden="true">
        <span
          ref="wolfHost"
          class="ws__wolf-pack"
          @pointerenter="activate"
          @pointerleave="deactivate"
        >
        <span
          v-for="i in 5"
          :key="i"
          class="ws__wolf"
          :class="{ 'is-lit': i <= lit }"
          :style="{ '--i': i }"
        ><WolfHead :is-lit="i <= lit" :index="i" /></span>
        </span>
      </span>

      <span class="ws__value">
        <strong>{{ score }}</strong><span class="ws__of">/5</span>
      </span>

      <span class="ws__name">{{ level.name }}</span>
      <span class="ws__chev" :class="{ 'is-open': open }">⌄</span>
    </button>

    <Transition name="ws-pop">
      <div v-if="open" class="ws__pop">
        <p class="ws__hint">{{ level.hint }}</p>

        <!-- Оценка без расшифровки бесполезна — §3.3 ТЗ -->
        <div class="ws__section">
          <h4 class="ws__h">Из чего сложилась оценка</h4>
          <ul class="ws__list">
            <li v-for="b in breakdown" :key="b.id" class="ws__item">
              <span class="ws__dot" :data-sev="b.severity" />
              <span class="ws__title">{{ b.title }}</span>
              <span class="ws__conf">{{ b.confidenceLabel }}</span>
              <span class="ws__impact">+{{ b.impact.toFixed(2) }}</span>
            </li>
          </ul>
        </div>

        <p v-if="isCapped" class="ws__cap">
          Оценка ограничена тремя волками: находки опираются только на
          лингвистику и детекцию ИИ. Более высокая оценка требует
          проверяемых фактических расхождений.
        </p>

        <!-- Несворачиваемая оговорка -->
        <p class="ws__disclaimer">
          Оценка показывает, насколько тщательно стоит проверить профиль
          в разговоре. Это не вывод о добросовестности кандидата и не
          основание для отказа.
        </p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ws { position: relative; }

.ws__trigger {
  display: flex;
  align-items: center;
  gap: var(--hf-s-2);
  width: 100%;
  padding: var(--hf-s-2) var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface);
  cursor: pointer;
  transition:
    border-color var(--hf-dur-fast) var(--hf-ease-out),
    background var(--hf-dur-fast) var(--hf-ease-out);
}
.ws__trigger:hover { border-color: var(--hf-border-strong); background: var(--hf-surface-raised); }
.ws__trigger:focus-visible { outline: none; box-shadow: var(--hf-glow); }

.ws__trigger.hf-ring-spin {
  border-color: var(--hf-border-strong);
  background: var(--hf-surface) padding-box;
  --hf-ring-mask: conic-gradient(
    from var(--hf-ring-angle),
    var(--hf-fg) 0%,
    var(--hf-fg) 25%,
    transparent 50%,
    transparent 75%,
    var(--hf-fg) 100%
  );
  -webkit-mask: var(--hf-ring-mask) border-box;
  mask: var(--hf-ring-mask) border-box;
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
  animation: hf-ring-rotate 3s linear infinite;
}

/* ── Волки ─────────────────────────────────────────────────────── */
.ws__wolves { display: inline-flex; gap: 2px; }

.ws__wolf-pack { display: inline-flex; gap: 2px; }

.ws__wolf {
  width: 18px;
  height: 18px;
  line-height: 1;
  opacity: 0.22;
  transform: scale(0.7);
  transition:
    opacity var(--hf-dur-fast) var(--hf-ease-out),
    transform var(--hf-dur-fast)
      var(--spring-bouncy);
}

.ws__wolf.is-lit {
  opacity: 1;
  transform: scale(1);
}

.ws__value { font-size: var(--hf-t-sm); color: var(--hf-fg-muted); }
.ws__value strong { font-size: var(--hf-t-lg); color: var(--hf-fg); }
.ws__of { opacity: 0.6; }

.ws__name {
  margin-right: auto;
  font-size: var(--hf-t-sm);
  color: var(--hf-fg-muted);
}

.ws__chev {
  color: var(--hf-fg-subtle);
  transition: transform var(--hf-dur-fast) var(--hf-ease-out);
}
.ws__chev.is-open { transform: rotate(180deg); }

/* ── Поповер ───────────────────────────────────────────────────── */
.ws__pop {
  position: absolute;
  z-index: 20;
  top: calc(100% + 6px);
  left: 0; right: 0;
  display: grid;
  gap: var(--hf-s-3);
  padding: var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface-raised);
  box-shadow: var(--hf-shadow-lg);
}

.ws__hint { margin: 0; font-size: var(--hf-t-md); color: var(--hf-fg); }

.ws__h {
  margin: 0 0 6px;
  font-size: var(--hf-t-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--hf-fg-subtle);
}

.ws__list { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }

.ws__item {
  display: grid;
  grid-template-columns: 6px 1fr auto auto;
  align-items: center;
  gap: var(--hf-s-2);
  font-size: var(--hf-t-sm);
}

.ws__dot { width: 6px; height: 6px; border-radius: 50%; }
.ws__dot[data-sev='critical'],
.ws__dot[data-sev='high']   { background: var(--hf-match-low); }
.ws__dot[data-sev='medium'] { background: var(--hf-match-mid); }
.ws__dot[data-sev='low']    { background: var(--hf-fg-subtle); }

.ws__title { color: var(--hf-fg); }
.ws__conf  { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }

.ws__impact {
  font: var(--hf-t-xs) / 1 var(--hf-mono);
  color: var(--hf-fg-muted);
}

.ws__cap,
.ws__disclaimer {
  margin: 0;
  padding: var(--hf-s-2);
  border-radius: var(--hf-r-md);
  font-size: var(--hf-t-xs);
  line-height: 1.5;
}

.ws__cap {
  color: var(--hf-match-mid);
  background: var(--hf-warn-muted);
}

.ws__disclaimer {
  color: var(--hf-fg-muted);
  background: var(--hf-surface-sunken);
}

/* ── Переход поповера ──────────────────────────────────────────── */
.ws-pop-enter-active,
.ws-pop-leave-active {
  transition:
    opacity var(--hf-dur-fast) var(--hf-ease-out),
    transform var(--hf-dur-fast) var(--hf-ease-out);
}
.ws-pop-enter-from,
.ws-pop-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }
</style>
