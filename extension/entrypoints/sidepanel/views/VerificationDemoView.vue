<script setup lang="ts">
import PrototypeBadge from '../ui/PrototypeBadge.vue'
/** VerificationView — контейнер модуля верификации и «Волкодава» (Stage 6).
 *  Подраздел Скрининга. Полоса-саммари всегда видна, разворачивается в отчёт.
 *  6 состояний (§5.4). WolfScale — оценка в волках. */
import { computed } from 'vue'
import HfButton from '../ui/HfButton.vue'
import HfIcon from '../ui/HfIcon.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import { useVerification } from '../composables/useVerification'
import { useToast } from '../composables/useToast'
import { useScrollShadow } from '../composables/useScrollShadow'
import WolfScale from './vf/WolfScale.vue'
import VfTimeline from './vf/VfTimeline.vue'
import VfContradictions from './vf/VfContradictions.vue'
import VfAiDetection from './vf/VfAiDetection.vue'
import VfVerifiability from './vf/VfVerifiability.vue'
import VfRedFlags from './vf/VfRedFlags.vue'
import VfQuestions from './vf/VfQuestions.vue'
import VfGitHub from './vf/VfGitHub.vue'
import { useCountUp, useViewMorph } from '../fx/narrative'

const {
  state, wolfState, activeSection, progressBlocks, lastRunAt, scenario,
  SECTION_ORDER, SECTION_META,
  timeline, contradictions, aiDetection, verifiability,
  allRedFlags, questions, github,
  wolfFindings, wolfDeep, wolfTriggers, wolfComputed,
  top3, mediumPlusCount, isRiskZone, wolfShouldAutoRun,
  run, runWolfhound, abort, toggleSection,
  clearReport, exportReport, setScenario,
} = useVerification()
const { toast } = useToast()

const { scrolled: vfScrolled, bind: bindVfScroll } = useScrollShadow()

const isIdle = computed(() => state.value === 'idle')
const isRunning = computed(() => state.value === 'running')
const isReady = computed(() => state.value === 'findings' || state.value === 'clean')
const hasReport = computed(() => isReady.value)

/* ── Доезжающие числа (ТЗ «Повествовательная анимация» §1) ─── */
const verifScoreCount = useCountUp(() => verifiability.value.value, { id: 'vf-verif', decimals: 0, suffix: '' })
const findingsCount = useCountUp(() => allRedFlags.value.length, { id: 'vf-findings', decimals: 0 })
const { morph: vfMorph } = useViewMorph()

function countFor(id: string): string {
  if (id === 'timeline') return timeline.value.findings.length ? `${timeline.value.findings.length}` : '0'
  if (id === 'contradictions') return `${contradictions.value.length}`
  if (id === 'ai') return aiDetection.value.band === 'uncertain' ? 'неинформ.' : `${aiDetection.value.score}%`
  if (id === 'verifiability') return `${verifiability.value.value}`
  if (id === 'questions') return `${questions.value.length}`
  if (id === 'github') return github.value.present ? 'проверен' : 'нет'
  if (id === 'redflags') return `${top3.value.top.length}`
  return ''
}

function onRun() {
  vfMorph(() => run())
}
function onRunWolfhound(deep = true) {
  vfMorph(() => runWolfhound(deep))
}

async function onExport() {
  const md = exportReport()
  try {
    await navigator.clipboard?.writeText(md)
    toast('Отчёт экспортирован (Markdown)', 'success')
  } catch { toast('Ошибка экспорта', 'error') }
}

function onClear() {
  clearReport()
  toast('Отчёт удалён', 'info')
}

function fmtDate(ts: number | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div ref="bindVfScroll" class="vf-view hf-scroll">
    <div style="padding: var(--hf-s-3) var(--hf-s-4) 0;"><PrototypeBadge /></div>
    <!-- Idle: кнопка «Проверить» -->
    <div v-if="isIdle" class="vf-idle">
      <HfEmpty icon="radar" title="Верификация данных"
        subtitle="Двухуровневая проверка: таймлайн, противоречия, детекция ИИ, топ-3 ред-флага и персональные вопросы. «Волкодав» — для зоны риска."
        action-label="Проверить" @action="onRun" />

      <!-- Переключатель сценариев (для тестов/демо) -->
      <div class="vf-scenarios">
        <span class="vf-scenarios-lbl">Сценарий:</span>
        <button v-for="s in (['demo', 'clean', 'risk', 'insufficient'] as const)" :key="s"
          class="vf-scen" :class="{ 'vf-scen--on': scenario === s }" @click="setScenario(s)">
          {{ s === 'demo' ? 'Демо' : s === 'clean' ? 'Чистый' : s === 'risk' ? 'Зона риска' : 'Мало данных' }}
        </button>
      </div>
      <p class="vf-eta">Бюджет проверки — до 8 секунд, в фоне.</p>

      <div class="vf-ethics">
        <div class="vf-ethics-row"><HfIcon name="check" :size="12" /><span>Только открытые данные — без скрейпинга закрытых источников.</span></div>
        <div class="vf-ethics-row"><HfIcon name="check" :size="12" /><span>У каждой находки — альтернативное объяснение.</span></div>
        <div class="vf-ethics-row"><HfIcon name="check" :size="12" /><span>Результат не влияет на матч-скор и не вызывает автоотказ.</span></div>
      </div>
    </div>

    <!-- Running: прогресс по блокам -->
    <div v-else-if="isRunning" class="vf-running">
      <div class="vf-run-head">
        <span class="hf-pulse-orb vf-run-orb" />
        <span>Проверяем профиль…</span>
        <button class="vf-run-stop" @click="abort"><HfIcon name="stop" :size="12" /> Отмена</button>
      </div>
      <ul class="vf-run-blocks">
        <li v-for="s in SECTION_ORDER" :key="s" class="vf-run-block" :class="{ 'vf-run-block--ready': progressBlocks[s] }">
          <span class="vf-run-block-orb" />
          <HfIcon :name="SECTION_META[s].icon" :size="12" />
          <span class="vf-run-block-label">{{ SECTION_META[s].label }}</span>
          <HfIcon v-if="progressBlocks[s]" name="check" :size="12" class="vf-run-block-check" />
        </li>
      </ul>
      <div class="vf-run-skel">
        <HfSkeleton :lines="3" width="60%" />
        <HfSkeleton :lines="2" width="45%" />
      </div>
    </div>

    <!-- Insufficient -->
    <div v-else-if="state === 'insufficient'" class="vf-insufficient">
      <HfIcon name="alert" :size="20" />
      <p>Профиль слишком беден для проверки.</p>
      <p class="vf-insufficient-hint">Не хватает: дат опыта, описания обязанностей, навыков.</p>
      <HfButton variant="ghost" size="sm" @click="onRun"><HfIcon name="refresh" :size="14" /> Повторить</HfButton>
    </div>

    <!-- Ready: полоса-саммари + отчёт -->
    <template v-else-if="hasReport">
      <!-- Липкая шапка -->
      <div class="vf-header hf-sticky" :class="{ 'is-scrolled': vfScrolled, 'hf-glass': vfScrolled }">
        <div class="vf-header-main">
          <div class="vf-header-title-row">
            <span class="vf-header-orb" :class="{ 'vf-header-orb--wolf': wolfState !== 'off' }">
              <HfIcon name="radar" :size="15" />
            </span>
            <span class="vf-header-title">Верификация</span>
            <span v-if="lastRunAt" class="vf-header-date">{{ fmtDate(lastRunAt) }}</span>
            <span v-if="isReady" class="vf-header-verif hf-numeric--animate" :style="{ minWidth: verifScoreCount.minWidthCh.value }" title="Индекс верифицируемости">
              <span aria-hidden="true">{{ verifScoreCount.display.value }}</span>
              <span class="hf-sr">{{ verifScoreCount.finalDisplay.value }}</span>
            </span>
          </div>

          <!-- WolfScale в саммари -->
          <div v-if="wolfState === 'done'" class="vf-header-wolf">
            <WolfScale :findings="wolfFindings" :active="true" />
          </div>
          <div v-else-if="wolfState === 'running'" class="vf-header-wolf-running">
            <span class="hf-pulse-orb" style="width:10px;height:10px;border-radius:50%;background:var(--hf-primary)" />
            <span>Волкодав работает…</span>
          </div>
        </div>
        <div class="vf-header-actions">
          <button v-if="wolfState === 'off' && wolfShouldAutoRun === false && state === 'findings'" class="vf-hact vf-hact--wolf" @click="onRunWolfhound(false)" title="Спустить Волкодава" aria-label="Спустить Волкодава">
            <HfIcon name="wolf" :size="14" /> Спустить Волкодава
          </button>
          <button class="vf-hact" @click="onExport" title="Экспорт отчёта" aria-label="Экспорт отчёта"><HfIcon name="download" :size="14" /></button>
          <button class="vf-hact" @click="onClear" title="Удалить отчёт" aria-label="Удалить отчёт"><HfIcon name="close" :size="14" /></button>
          <button class="vf-hact" @click="onRun" title="Перепроверить" aria-label="Перепроверить"><HfIcon name="refresh" :size="14" /></button>
        </div>
      </div>

      <!-- Clean -->
      <div v-if="state === 'clean'" class="vf-clean">
        <HfIcon name="check" :size="20" />
        <p>Существенных расхождений не найдено</p>
        <p class="vf-clean-hint">Нейтральная оценка. Проверка не заменяет интервью — она лишь не выявила поводов для уточнения.</p>
      </div>

      <!-- Триггеры Волкодава -->
      <div v-if="wolfState !== 'off' && wolfTriggers.length" class="vf-triggers">
        <HfIcon name="alert" :size="12" />
        <span class="vf-triggers-lbl">Волкодав запущен:</span>
        <span v-for="t in wolfTriggers" :key="t" class="vf-trigger">{{ t }}</span>
      </div>

      <!-- Глубокие секции Волкодава -->
      <Transition name="vf-wolf">
        <div v-if="wolfState === 'done' && wolfDeep.length" class="vf-wolf-deep">
          <div class="vf-wolf-deep-lbl">Углублённый разбор (Волкодав)</div>
          <div v-for="(d, i) in wolfDeep" :key="i" class="vf-wolf-deep-item hf-cascade" :style="{ '--hf-i': Math.min(i, 7) }">
            <span class="vf-wolf-deep-item-lbl">{{ d.label }}</span>
            <span class="vf-wolf-deep-item-detail">{{ d.detail }}</span>
          </div>
        </div>
      </Transition>

      <!-- Аккордеон секций -->
      <div class="vf-accordion">
        <div
          v-for="sec in SECTION_ORDER"
          :key="sec"
          class="vf-section"
          :class="{ 'vf-section--open': activeSection === sec }"
        >
          <button class="vf-section-head" @click="toggleSection(sec)" :aria-expanded="activeSection === sec">
            <HfIcon :name="SECTION_META[sec].icon" :size="14" class="vf-section-icon" />
            <span class="vf-section-label">{{ SECTION_META[sec].label }}</span>
            <span class="vf-section-count">{{ countFor(sec) }}</span>
            <HfIcon name="chevron-down" :size="12" class="vf-section-chev" :class="{ 'vf-section-chev--open': activeSection === sec }" />
          </button>

          <div class="vf-section-body-wrap">
            <div class="vf-section-body">
              <VfRedFlags v-if="sec === 'redflags'" />
              <VfTimeline v-else-if="sec === 'timeline'" />
              <VfContradictions v-else-if="sec === 'contradictions'" />
              <VfAiDetection v-else-if="sec === 'ai'" />
              <VfVerifiability v-else-if="sec === 'verifiability'" />
              <VfQuestions v-else-if="sec === 'questions'" />
              <VfGitHub v-else-if="sec === 'github'" />
            </div>
          </div>
        </div>
      </div>

      <!-- Несворачиваемая оговорка внизу -->
      <p class="vf-footer-disclaimer">
        Оценка показывает, насколько тщательно стоит проверить профиль в разговоре.
        Это не вывод о добросовестности кандидата и не основание для отказа.
      </p>
    </template>

    <!-- Partial failure -->
    <div v-else-if="state === 'partial'" class="vf-partial">
      <HfIcon name="alert" :size="20" />
      <p>Частичный сбой — часть блоков недоступна.</p>
      <HfButton variant="ghost" size="sm" @click="onRun"><HfIcon name="refresh" :size="14" /> Повторить</HfButton>
    </div>
  </div>
</template>

<script lang="ts">
export default { name: 'VerificationView' }
</script>

<style scoped>
.vf-view { height: 100%; overflow-y: auto; display: flex; flex-direction: column; }

/* ── Idle ─────────────────────────────────────────────────────── */
.vf-idle { padding: var(--hf-s-4); display: flex; flex-direction: column; gap: var(--hf-s-4); }
.vf-scenarios { display: flex; align-items: center; gap: var(--hf-s-1); flex-wrap: wrap; }
.vf-scenarios-lbl { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.vf-scen { padding: var(--hf-s-1) var(--hf-s-2); border-radius: var(--hf-r-sm); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); background: var(--hf-surface-sunken); transition: all var(--hf-dur-fast) var(--hf-ease-out); }
.vf-scen:hover { color: var(--hf-fg); }
.vf-scen--on { background: var(--hf-primary); color: var(--hf-fg-on-accent); }
.vf-eta { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.vf-ethics { display: flex; flex-direction: column; gap: var(--hf-s-1); padding: var(--hf-s-3); border-radius: var(--hf-r-md); background: var(--hf-surface-sunken); }
.vf-ethics-row { display: flex; align-items: flex-start; gap: var(--hf-s-2); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); line-height: var(--hf-lh-normal); }
.vf-ethics-row :deep(.hf-icon) { color: var(--hf-match-high); margin-top: 1px; flex-shrink: 0; }

/* ── Running ──────────────────────────────────────────────────── */
.vf-running { padding: var(--hf-s-4); display: flex; flex-direction: column; gap: var(--hf-s-4); }
.vf-run-head { display: flex; align-items: center; gap: var(--hf-s-2); font-size: var(--hf-t-sm); color: var(--hf-fg); }
.vf-run-orb { width: 10px; height: 10px; border-radius: 50%; background: var(--hf-primary); }
.vf-run-stop { display: flex; align-items: center; gap: var(--hf-s-1); margin-left: auto; padding: var(--hf-s-1) var(--hf-s-2); border-radius: var(--hf-r-sm); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); background: var(--hf-surface-sunken); transition: all var(--hf-dur-fast) var(--hf-ease-out); }
.vf-run-stop:hover { color: var(--hf-err); }
.vf-run-blocks { display: flex; flex-direction: column; gap: var(--hf-s-1); list-style: none; padding: 0; margin: 0; }
.vf-run-block { display: flex; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-2); border-radius: var(--hf-r-sm); font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); transition: all var(--hf-dur-fast) var(--hf-ease-out); }
.vf-run-block--ready { color: var(--hf-fg); }
.vf-run-block-orb { width: 6px; height: 6px; border-radius: 50%; background: var(--hf-border-strong); flex-shrink: 0; transition: background var(--hf-dur-fast) var(--hf-ease-out); }
.vf-run-block--ready .vf-run-block-orb { background: var(--hf-match-high); }
.vf-run-block-label { flex: 1; }
.vf-run-block-check { color: var(--hf-match-high); }
.vf-run-skel { margin-top: var(--hf-s-2); display: flex; flex-direction: column; gap: var(--hf-s-2); }

/* ── Insufficient / Partial ───────────────────────────────────── */
.vf-insufficient, .vf-partial { display: flex; flex-direction: column; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-8); text-align: center; color: var(--hf-fg-muted); }
.vf-insufficient :deep(.hf-icon), .vf-partial :deep(.hf-icon) { color: var(--hf-match-low); }
.vf-insufficient-hint { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); max-width: 280px; }

/* ── Header ───────────────────────────────────────────────────── */
.vf-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--hf-s-2); padding: var(--hf-s-3) var(--hf-s-4); background: var(--hf-surface); z-index: 10; }
.vf-header.is-scrolled { border-bottom: 1px solid var(--hf-border); }
.vf-header-main { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.vf-header-title-row { display: flex; align-items: center; gap: var(--hf-s-2); }
.vf-header-orb { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--hf-r-pill); background: var(--hf-primary-muted); color: var(--hf-primary); }
.vf-header-orb--wolf { background: var(--hf-match-low-muted); color: var(--hf-match-low); }
.vf-header-title { font-size: var(--hf-t-md); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.vf-header-date { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); font-family: var(--hf-mono); }
.vf-header-verif { font-size: var(--hf-t-md); font-weight: var(--hf-fw-bold); color: var(--hf-primary); font-variant-numeric: tabular-nums; font-family: var(--hf-mono); }
.vf-header-wolf { margin-top: var(--hf-s-1); }
.vf-header-wolf-running { display: flex; align-items: center; gap: var(--hf-s-2); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }
.vf-header-actions { display: flex; gap: var(--hf-s-1); flex-shrink: 0; }
.vf-hact { display: flex; align-items: center; justify-content: center; gap: 4px; height: 28px; min-width: 28px; padding: 0 var(--hf-s-2); border-radius: var(--hf-r-sm); color: var(--hf-fg-muted); transition: background var(--hf-dur-fast), color var(--hf-dur-fast); font-size: var(--hf-t-xs); }
.vf-hact:hover { background: var(--hf-surface-sunken); color: var(--hf-fg); }
.vf-hact--wolf { background: var(--hf-match-low-muted); color: var(--hf-match-low); font-weight: var(--hf-fw-medium); }
.vf-hact--wolf:hover { background: var(--hf-match-low); color: var(--hf-fg-on-accent); }

/* ── Clean ────────────────────────────────────────────────────── */
.vf-clean { display: flex; flex-direction: column; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-8); text-align: center; color: var(--hf-match-high); }
.vf-clean-hint { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); max-width: 280px; }

/* ── Triggers ─────────────────────────────────────────────────── */
.vf-triggers { display: flex; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-2) var(--hf-s-4); background: var(--hf-match-low-muted); color: var(--hf-match-low); font-size: var(--hf-t-xs); flex-wrap: wrap; }
.vf-triggers-lbl { font-weight: var(--hf-fw-semibold); }
.vf-trigger { padding: 1px 7px; border-radius: var(--hf-r-pill); background: var(--hf-surface); color: var(--hf-match-low); }

/* ── Wolf deep ────────────────────────────────────────────────── */
.vf-wolf-deep { padding: var(--hf-s-3) var(--hf-s-4); display: flex; flex-direction: column; gap: var(--hf-s-1); }
.vf-wolf-deep-lbl { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-match-low); margin-bottom: var(--hf-s-1); }
.vf-wolf-deep-item { display: flex; flex-direction: column; gap: 1px; padding: var(--hf-s-2) var(--hf-s-3); border-radius: var(--hf-r-md); background: var(--hf-surface); border: 1px solid var(--hf-border); border-left: 3px solid var(--hf-match-low); }
.vf-wolf-deep-item-lbl { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.vf-wolf-deep-item-detail { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); line-height: var(--hf-lh-normal); }
.vf-wolf-enter-active, .vf-wolf-leave-active { transition: opacity var(--hf-dur-slow) var(--hf-ease-out), transform var(--hf-dur-slow) var(--hf-ease-out); overflow: hidden; }
.vf-wolf-enter-from, .vf-wolf-leave-to { opacity: 0; transform: translateY(-8px); }

/* ── Accordion ────────────────────────────────────────────────── */
.vf-accordion { padding: var(--hf-s-2) var(--hf-s-4) var(--hf-s-6); display: flex; flex-direction: column; gap: var(--hf-s-1); }
.vf-section { border: 1px solid var(--hf-border); border-radius: var(--hf-r-lg); background: var(--hf-surface); overflow: hidden; transition: border-color var(--hf-dur-fast) var(--hf-ease-out); }
.vf-section--open { border-color: var(--hf-border-strong); }
.vf-section-head { display: flex; align-items: center; gap: var(--hf-s-2); width: 100%; padding: var(--hf-s-3) var(--hf-s-4); background: var(--hf-surface-raised); color: var(--hf-fg); font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); text-align: left; transition: background var(--hf-dur-fast); }
.vf-section-head:hover { background: var(--hf-surface-sunken); }
.vf-section-icon { color: var(--hf-primary); flex-shrink: 0; }
.vf-section-label { flex: 1; }
.vf-section-count { font-size: var(--hf-t-xs); padding: 1px 7px; border-radius: var(--hf-r-pill); background: var(--hf-surface-sunken); color: var(--hf-fg-muted); font-weight: var(--hf-fw-semibold); }
.vf-section-chev { color: var(--hf-fg-subtle); transition: transform var(--hf-dur-fast) var(--hf-ease-out); }
.vf-section-chev--open { transform: rotate(180deg); }

/* Раскрытие через grid-template-rows: 0fr → 1fr */
.vf-section-body-wrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--spring-gentle-dur) var(--spring-gentle); }
.vf-section--open .vf-section-body-wrap { grid-template-rows: 1fr; }
.vf-section-body { overflow: hidden; min-height: 0; }
.vf-section--open .vf-section-body { padding: var(--hf-s-4); border-top: 1px solid var(--hf-border); }

/* ── Footer disclaimer ────────────────────────────────────────── */
.vf-footer-disclaimer { margin: 0; padding: var(--hf-s-3) var(--hf-s-4); text-align: center; font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); border-top: 1px solid var(--hf-border); }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>
