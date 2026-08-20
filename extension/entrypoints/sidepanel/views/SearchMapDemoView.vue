<script setup lang="ts">
import PrototypeBadge from '../ui/PrototypeBadge.vue'
/** SearchMapView — контейнер «Карты поиска» (Stage 5).
 *  Аккордеон из 6 секций, липкая шапка с действиями, 5 состояний.
 *  Не отдельный ViewId — внутренний подраздел SourcingView. */
import { computed } from 'vue'
import HfButton from '../ui/HfButton.vue'
import HfIcon from '../ui/HfIcon.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import { useSidekick, useSidekickActions } from '../composables/useSidekick'
import { useSearchMap } from '../composables/useSearchMap'
import { useToast } from '../composables/useToast'
import { useScrollShadow } from '../composables/useScrollShadow'
import SmDonors from './sm/SmDonors.vue'
import SmCapacity from './sm/SmCapacity.vue'
import SmHypotheses from './sm/SmHypotheses.vue'
import SmQueries from './sm/SmQueries.vue'
import SmAntiMap from './sm/SmAntiMap.vue'
import SmPlan from './sm/SmPlan.vue'
import SearchCompass from './sm/SearchCompass.vue'
import type { CompassSection } from '../fx/signature'
import { useCountUp } from '../fx/narrative'
import { useViewMorph } from '../fx/narrative'

const { jobs, selectedJobId } = useSidekick()
const { } = useSidekickActions()
const {
  state, calibrated, searchEngine, activeJobTitle, lastGeneratedAt,
  staleBanner, searchMapVersion, openSections, sectionReady, SECTION_ORDER,
  toggleSection, generate, regenerate, visibleDonors, enabledHypotheses,
  queries, antiMap, plan, hypotheses, doneSteps, usedQueries, totalDonorsFound,
  totalDonorsResponses, allQueriesText, exportMarkdown, exportDonorsCsv,
} = useSearchMap()
const { toast } = useToast()

const { scrolled: smScrolled, bind: bindSmScroll } = useScrollShadow()

/* ── Доезжающие числа (ТЗ «Повествовательная анимация» §1) ─── */
const donorsCount = useCountUp(() => visibleDonors.value.length, { id: 'sm-donors', decimals: 0 })
const hypothesesCount = useCountUp(() => enabledHypotheses.value.length, { id: 'sm-hyp', decimals: 0 })
const queriesUsedCount = useCountUp(() => usedQueries.value, { id: 'sm-queries', decimals: 0 })
const totalFoundCount = useCountUp(() => totalDonorsFound.value, { id: 'sm-found', compact: true })
const { morph: smMorph } = useViewMorph()

/* ── Слипающиеся заголовки (ТЗ «Повествовательная анимация» §3) ── */
import { useStickyHeaders } from '../fx/narrative'
import { ref as _ref, h, defineComponent } from 'vue'

const accordionRef = _ref<HTMLElement | null>(null)
const { isStuck } = useStickyHeaders(accordionRef, { topOffset: 0, baseZ: 30 })

/** Микрокомпонент: счётчик в прилипшем заголовке с доезжающим числом. */
const SectionCount = defineComponent({
  props: { value: { type: Number, default: 0 }, id: { type: String, default: '' } },
  setup(props) {
    const cu = useCountUp(() => props.value, { id: `sm-sec-${props.id}`, decimals: 0 })
    return () => h('span', { class: 'hf-stuck-count', key: props.value }, [
      h('span', { 'aria-hidden': 'true' }, cu.display.value),
      h('span', { class: 'hf-sr' }, cu.finalDisplay.value),
    ])
  },
})

/** Числовое значение счётчика секции для доезжающего числа. */
function sectionCountValue(sec: string): number {
  switch (sec) {
    case 'donors': return visibleDonors.value.length
    case 'hypotheses': return hypotheses.value.length
    case 'queries': return queries.value.length
    case 'antimap': return antiMap.value.length
    case 'plan': return plan.value.length
    default: return 0
  }
}

const SECTION_META: Record<string, { label: string; icon: string; count: () => string }> = {
  capacity:   { label: 'Ёмкость рынка',    icon: 'gauge',        count: () => '' },
  donors:     { label: 'Компании-доноры',  icon: 'building',     count: () => `${visibleDonors.value.length}` },
  hypotheses: { label: 'Гипотезы',         icon: 'layers',       count: () => `${hypothesesTotal.value}` },
  queries:    { label: 'Запросы',          icon: 'search',       count: () => `${queries.value.length}` },
  antimap:    { label: 'Анти-карта',       icon: 'ban',          count: () => `${antiMap.value.length}` },
  plan:       { label: 'План действий',    icon: 'list-checks',  count: () => `${plan.value.length} шагов` },
}

const hypothesesTotal = computed(() => hypotheses.value.length)

const isReady = computed(() => state.value === 'ready' || state.value === 'partial')
const isGenerating = computed(() => state.value === 'generating')

/* ── Компас карты поиска (§4 ТЗ «Фирменные детали») ──────────── */
const compassSections = computed<CompassSection[]>(() => [
  { id: 'capacity',   label: 'Ёмкость рынка',    unseenRatio: 0.4, confidence: 0.7, historicalSuccess: 0.5 },
  { id: 'donors',     label: 'Компании-доноры',  unseenRatio: visibleDonors.value.length ? 0.8 : 0, confidence: 0.9, historicalSuccess: 0.7 },
  { id: 'hypotheses', label: 'Гипотезы',         unseenRatio: hypotheses.value.length ? 0.5 : 0, confidence: 0.6, historicalSuccess: 0.5 },
  { id: 'queries',    label: 'Запросы',          unseenRatio: queries.value.length ? 0.3 : 0, confidence: 0.8, historicalSuccess: 0.6 },
  { id: 'antimap',    label: 'Анти-карта',       unseenRatio: antiMap.value.length ? 0.1 : 0, confidence: 0.4, historicalSuccess: 0.3 },
  { id: 'plan',       label: 'План действий',    unseenRatio: plan.value.length ? 0.2 : 0, confidence: 0.5, historicalSuccess: 0.4 },
])

function onGenerate() {
  smMorph(() => generate(selectedJobId.value || 'demo', jobs.value.find(j => j.id === selectedJobId.value)?.title || 'Demo вакансия'))
}
function onRegenerate() {
  smMorph(() => regenerate())
}
async function copyAll() {
  try {
    await navigator.clipboard?.writeText(allQueriesText.value)
    toast('Все запросы скопированы', 'success')
  } catch { toast('Не удалось скопировать', 'error') }
}
async function exportMd() {
  const md = exportMarkdown()
  try {
    await navigator.clipboard?.writeText(md)
    toast('Карта экспортирована в буфер (Markdown)', 'success')
  } catch { toast('Ошибка экспорта', 'error') }
}
async function exportCsv() {
  const csv = exportDonorsCsv()
  try {
    await navigator.clipboard?.writeText(csv)
    toast('Доноры экспортированы (CSV)', 'success')
  } catch { toast('Ошибка экспорта', 'error') }
}
function fmtDate(ts: number | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div ref="bindSmScroll" class="sm-view hf-scroll" aria-live="polite">
    <div style="padding: var(--hf-s-3) var(--hf-s-4) 0;"><PrototypeBadge /></div>
    <!-- Empty: вакансия не выбрана -->
    <div v-if="state === 'empty'" class="sm-empty">
      <HfEmpty icon="map" title="Карта поиска"
        subtitle="Выберите вакансию — панель построит карту: компании-доноры, поисковые гипотезы, готовые запросы, анти-карту и план действий."
        action-label="Построить карту" @action="onGenerate" />
      <div v-if="jobs.length" class="sm-empty-job">
        <select v-model="selectedJobId" class="hf-input">
          <option value="">— Выберите вакансию —</option>
          <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }}</option>
        </select>
      </div>
    </div>

    <!-- Generating -->
    <div v-else-if="isGenerating" class="sm-gen hf-ring-spin">
      <div class="sm-gen-head">
        <span class="hf-pulse-orb sm-gen-orb" />
        <span>Строим карту для «{{ activeJobTitle }}»…</span>
      </div>
      <ul class="sm-gen-sections">
        <li v-for="sec in SECTION_ORDER" :key="sec" class="sm-gen-sec" :class="{ 'sm-gen-sec--ready': sectionReady[sec] }">
          <span class="sm-gen-sec-orb" />
          <span class="sm-gen-sec-label">{{ SECTION_META[sec].label }}</span>
          <HfIcon v-if="sectionReady[sec]" name="check" :size="12" class="sm-gen-sec-check" />
        </li>
      </ul>
    </div>

    <!-- Error -->
    <div v-else-if="state === 'error'" class="sm-error">
      <HfIcon name="alert" :size="24" />
      <p>Не удалось построить карту. Уже полученные данные сохранены.</p>
      <HfButton variant="ghost" size="sm" @click="onGenerate">Повторить</HfButton>
    </div>

    <!-- Ready / Partial / Stale -->
    <template v-else>
      <!-- Stale баннер -->
      <Transition name="sm-banner">
        <div v-if="staleBanner" class="sm-stale-banner">
          <HfIcon name="alert" :size="14" />
          <span>Требования вакансии обновились</span>
          <HfButton variant="subtle" size="sm" @click="onRegenerate">Пересобрать</HfButton>
        </div>
      </Transition>

      <!-- Липкая шапка -->
      <div class="sm-header hf-sticky" :class="{ 'is-scrolled': smScrolled, 'hf-glass': smScrolled }">
        <div class="sm-header-main">
          <div class="sm-header-title">
            <SearchCompass v-if="isReady" :sections="compassSections" />
            <span>{{ activeJobTitle }}</span>
          </div>
          <div class="sm-header-meta">
            <span v-if="!calibrated" class="sm-cal-tag" title="Карта построена без калибровки по истории ATS">
              <HfIcon name="alert" :size="10" /> Без калибровки
            </span>
            <span class="sm-ver">v{{ searchMapVersion }}</span>
            <span v-if="lastGeneratedAt" class="sm-date">{{ fmtDate(lastGeneratedAt) }}</span>
            <span v-if="isReady" class="sm-found-count hf-numeric--animate" :style="{ minWidth: totalFoundCount.minWidthCh.value }" title="Найдено профилей">
              <span aria-hidden="true">{{ totalFoundCount.display.value }}</span>
              <span class="hf-sr">{{ totalFoundCount.finalDisplay.value }}</span>
            </span>
          </div>
        </div>
        <div class="sm-header-actions">
          <button class="sm-hact" @click="copyAll" title="Скопировать все запросы"><HfIcon name="copy" :size="13" /></button>
          <button class="sm-hact" @click="exportMd" title="Экспорт Markdown"><HfIcon name="download" :size="13" /></button>
          <button class="sm-hact" @click="exportCsv" title="Экспорт доноров CSV"><HfIcon name="building" :size="13" /></button>
          <button class="sm-hact sm-hact--engine" @click="searchEngine = searchEngine === 'google' ? 'yandex' : 'google'">{{ searchEngine === 'google' ? 'G' : 'Я' }}</button>
          <button class="sm-hact sm-hact--rebuild" @click="onRegenerate" title="Пересобрать"><HfIcon name="refresh" :size="13" /></button>
        </div>
      </div>

      <!-- Сводка -->
     <div class="sm-summary">
        <div class="sm-summary-item">
          <span class="sm-summary-num hf-numeric--animate" :style="{ minWidth: donorsCount.minWidthCh.value }">
            <span aria-hidden="true">{{ donorsCount.display.value }}</span>
            <span class="hf-sr">{{ donorsCount.finalDisplay.value }}</span>
          </span>
          <span class="sm-summary-label">доноров</span>
        </div>
        <div class="sm-summary-item">
          <span class="sm-summary-num hf-numeric--animate" :style="{ minWidth: hypothesesCount.minWidthCh.value }">
            <span aria-hidden="true">{{ hypothesesCount.display.value }}</span>
            <span class="hf-sr">{{ hypothesesCount.finalDisplay.value }}</span>
          </span>
          <span class="sm-summary-label">гипотез вкл.</span>
        </div>
        <div class="sm-summary-item">
          <span class="sm-summary-num hf-numeric--animate" :style="{ minWidth: queriesUsedCount.minWidthCh.value }">
            <span aria-hidden="true">{{ queriesUsedCount.display.value }}</span>
            <span class="hf-sr">{{ queriesUsedCount.finalDisplay.value }}</span>
          </span>
          <span class="sm-summary-label">запросов исп.</span>
        </div>
        <div class="sm-summary-item">
          <span class="sm-summary-num hf-numeric--animate" :style="{ minWidth: `${String(doneSteps).length + 1 + String(plan.length).length}ch` }">
            <span aria-hidden="true">{{ doneSteps }}/{{ plan.length }}</span>
          </span>
          <span class="sm-summary-label">шагов плана</span>
        </div>
      </div>

      <!-- Аккордеон секций -->
      <div ref="accordionRef" class="sm-accordion">
        <section
          v-for="sec in SECTION_ORDER"
          :key="sec"
          class="sm-section"
          :data-hf-section="sec"
          :class="{ 'sm-section--open': openSections[sec], 'sm-section--ready': sectionReady[sec] }"
        >
          <span class="hf-sentinel" data-hf-sentinel="top" aria-hidden="true" />
          <button
            class="sm-section-head"
            data-hf-header
            :class="{ 'is-stuck': isStuck(sec).value }"
            @click="toggleSection(sec as any)"
          >
            <HfIcon :name="SECTION_META[sec].icon" :size="15" class="sm-section-icon" />
            <span class="sm-section-label">{{ SECTION_META[sec].label }}</span>
            <span v-if="SECTION_META[sec].count() && !isStuck(sec).value" class="sm-section-count hf-num">{{ SECTION_META[sec].count() }}</span>
            <SectionCount v-if="isStuck(sec).value && sectionCountValue(sec) > 0" :value="sectionCountValue(sec)" :id="sec" />
            <span v-if="!sectionReady[sec]" class="hf-pulse-orb sm-section-orb" />
            <HfIcon :name="openSections[sec] ? 'chevron-up' : 'chevron-down'" :size="14" class="sm-section-chev" />
          </button>

          <Transition name="sm-grid">
            <div v-if="openSections[sec]" class="sm-section-body">
              <SmCapacity v-if="sec === 'capacity'" />
              <SmDonors v-else-if="sec === 'donors'" />
              <SmHypotheses v-else-if="sec === 'hypotheses'" />
              <SmQueries v-else-if="sec === 'queries'" />
              <SmAntiMap v-else-if="sec === 'antimap'" />
              <SmPlan v-else-if="sec === 'plan'" />
            </div>
          </Transition>
          <span class="hf-sentinel" data-hf-sentinel="bottom" aria-hidden="true" />
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sm-view { height: 100%; overflow-y: auto; max-width: var(--hf-content-max); margin-inline: auto; mask-image: linear-gradient(to bottom, transparent 0, #000 14px, #000 calc(100% - 18px), transparent 100%); }

.sm-empty { display: flex; flex-direction: column; gap: var(--hf-s-4); }
.sm-empty-job { padding: 0 var(--hf-s-4); }

.sm-gen { padding: var(--hf-s-6) var(--hf-s-4); }
.sm-gen-head { display: flex; align-items: center; gap: var(--hf-s-2); margin-bottom: var(--hf-s-4); color: var(--hf-fg-muted); font-size: var(--hf-t-sm); }
.sm-gen-orb { width: 10px; height: 10px; border-radius: 50%; background: var(--hf-primary); }
.sm-gen-sections { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--hf-s-2); }
.sm-gen-sec { display: flex; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-2) var(--hf-s-3); border-radius: var(--hf-r-md); background: var(--hf-surface); border: 1px solid var(--hf-border); font-size: var(--hf-t-sm); color: var(--hf-fg-muted); transition: all var(--hf-dur-fast) var(--hf-ease-out); }
.sm-gen-sec--ready { color: var(--hf-fg); border-color: var(--hf-match-high); }
.sm-gen-sec-orb { width: 8px; height: 8px; border-radius: 50%; background: var(--hf-fg-subtle); }
.sm-gen-sec--ready .sm-gen-sec-orb { background: var(--hf-match-high); }
.sm-gen-sec-check { color: var(--hf-match-high); margin-left: auto; }

.sm-error { display: flex; flex-direction: column; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-8); text-align: center; color: var(--hf-err); }

.sm-stale-banner { display: flex; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-2) var(--hf-s-3); margin: 0 var(--hf-s-4) var(--hf-s-2); background: var(--hf-warn-muted); color: var(--hf-warn); border-radius: var(--hf-r-md); font-size: var(--hf-t-sm); }
.sm-stale-banner button { margin-left: auto; }

.sm-header { display: flex; align-items: flex-start; gap: var(--hf-s-2); padding: var(--hf-s-3) var(--hf-s-4); }
.sm-header-main { flex: 1; min-width: 0; }
.sm-header-title { font-size: var(--hf-t-md); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sm-header-meta { display: flex; align-items: center; gap: var(--hf-s-2); margin-top: 2px; }
.sm-cal-tag { display: inline-flex; align-items: center; gap: 3px; font-size: var(--hf-t-xs); padding: 1px 6px; border-radius: var(--hf-r-pill); background: var(--hf-warn-muted); color: var(--hf-warn); }
.sm-ver { font-size: var(--hf-t-xs); font-family: var(--hf-mono); color: var(--hf-fg-subtle); }
.sm-date { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.sm-header-actions { display: flex; gap: var(--hf-s-1); flex-shrink: 0; }
.sm-hact { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--hf-r-sm); color: var(--hf-fg-muted); transition: background var(--hf-dur-fast), color var(--hf-dur-fast); }
.sm-hact:hover { background: var(--hf-surface-sunken); color: var(--hf-fg); }
.sm-hact--engine { font-family: var(--hf-mono); font-weight: var(--hf-fw-bold); font-size: var(--hf-t-xs); }
.sm-hact--rebuild:hover { background: var(--hf-primary-muted); color: var(--hf-primary); }

.sm-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--hf-s-2); padding: var(--hf-s-3) var(--hf-s-4); border-bottom: 1px solid var(--hf-border); }
.sm-summary-item { display: flex; flex-direction: column; gap: 1px; }
.sm-summary-num { font-size: var(--hf-t-lg); font-weight: var(--hf-fw-bold); color: var(--hf-fg); font-family: var(--hf-mono); }
.sm-summary-label { font-size: 10px; color: var(--hf-fg-subtle); text-transform: uppercase; letter-spacing: 0.04em; }

.sm-accordion { padding: var(--hf-s-3) var(--hf-s-4) var(--hf-s-6); display: flex; flex-direction: column; gap: var(--hf-s-2); }
.sm-section { border: 1px solid var(--hf-border); border-radius: var(--hf-r-lg); background: var(--hf-surface); box-shadow: var(--hf-lit); }
.sm-section--ready:not(.sm-section--open) { border-color: var(--hf-border-strong); }
.sm-section-head { display: flex; align-items: center; gap: var(--hf-s-2); width: 100%; padding: var(--hf-s-3) var(--hf-s-4); background: var(--hf-surface-raised); color: var(--hf-fg); font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); text-align: left; transition: background var(--hf-dur-fast), border-color var(--hf-dur-fast), box-shadow var(--hf-dur-fast); border-radius: var(--hf-r-lg) var(--hf-r-lg) 0 0; }
.sm-section-head:hover { background: var(--hf-surface-sunken); }
.sm-section-head.is-stuck { border-radius: 0; }
.sm-section-icon { color: var(--hf-primary); flex-shrink: 0; }
.sm-section-label { flex: 1; }
.sm-section-count { font-size: var(--hf-t-xs); padding: 1px 7px; border-radius: var(--hf-r-pill); background: var(--hf-surface-sunken); color: var(--hf-fg-muted); font-weight: var(--hf-fw-semibold); }
.sm-section-orb { width: 8px; height: 8px; }
.sm-section-chev { color: var(--hf-fg-subtle); }

.sm-section-body { padding: var(--hf-s-4); border-top: 1px solid var(--hf-border); border-radius: 0 0 var(--hf-r-lg) var(--hf-r-lg); }

.sm-grid-enter-active, .sm-grid-leave-active { transition: opacity var(--hf-dur-base) var(--hf-ease-out); overflow: hidden; }
.sm-grid-enter-from, .sm-grid-leave-to { opacity: 0; }
.sm-banner-enter-active, .sm-banner-leave-active { transition: opacity var(--hf-dur-base) var(--hf-ease-out), transform var(--hf-dur-base) var(--hf-ease-out); }
.sm-banner-enter-from, .sm-banner-leave-to { opacity: 0; transform: translateY(-6px); }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>
