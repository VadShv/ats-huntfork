<script setup lang="ts">
/**
 * «Расход ИИ» — дашборд затрат на ИИ по действиям (docs/tz-ai-usage.md §8.1).
 *
 * Блоки: фильтры (в URL) → баннер бюджета → KPI → динамика → операции (дерево
 * фича → операция) → разрезы (модели / люди / вакансии / триггеры / конфигурации)
 * → потери и аномалии → журнал вызовов с трейсом. Суммы видны только при
 * aiUsage:view_costs; без него — токены и вызовы (сервер вырезает суммы сам).
 */
import {
  Coins, Download, Filter, X, TrendingUp, TrendingDown, AlertTriangle, Activity, Gauge,
  ChevronRight, ChevronDown, Info, Settings, Clock, Zap,
} from 'lucide-vue-next'
import {
  AI_FEATURES, AI_FEATURE_LABELS, AI_TRIGGERS, AI_TRIGGER_LABELS, AI_STATUSES, AI_STATUS_LABELS,
  type AiFeature, type AiUsageStatus,
} from '~~/shared/aiUsage/catalog'
import type { AiCurrency } from '~~/shared/aiUsage/cost'
import {
  AI_STATUS_TONE, AI_USAGE_PERIOD_OPTIONS, compactQuery, formatDateTimeRu, formatDuration, formatPct,
  useAiUsageFilters, useAiUsageMoney, type AiUsagePeriod,
} from '~/composables/useAiUsage'
import { baseCartesianOption } from '~/utils/analytics/chart-theme'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})
useSeoMeta({ title: 'Расход ИИ', robots: 'noindex, nofollow' })

const { allowed: canSee } = usePermission({ aiUsage: ['view_own'] })
const { isDark } = useColorMode()

const { filters, setFilter, setFilters, resetFilters, activeCount } = useAiUsageFilters()
const query = computed(() => compactQuery(filters.value))

// ── Данные ───────────────────────────────────────────────────────
const reqHeaders = useRequestHeaders(['cookie'])
/** useAsyncData + $fetch(string): обходит глубокий вывод типов nitro-маршрутов (TS2589). */
function useApi(key: string, path: string, q: () => Record<string, string>, opts: { lazy?: boolean } = {}) {
  const url: string = path
  return useAsyncData<any>(key, () => $fetch(url, { query: q(), headers: reqHeaders }), {
    watch: [computed(() => JSON.stringify(q()))],
    lazy: opts.lazy,
  })
}

const { data: summary, status: summaryStatus, error: summaryError, refresh: refreshSummary } = useApi('ai-usage-summary', '/api/ai-usage/summary', () => query.value)
const chartGroup = ref<'feature' | 'model' | 'trigger'>('feature')
const { data: series, status: seriesStatus } = useApi('ai-usage-series', '/api/ai-usage/timeseries', () => ({ ...query.value, groupBy: chartGroup.value }))
const { data: ops, status: opsStatus } = useApi('ai-usage-ops', '/api/ai-usage/breakdown', () => ({ ...query.value, by: 'operation' }))
type Tab = 'model' | 'user' | 'job' | 'trigger' | 'config'
const tab = ref<Tab>('model')
const { data: dims, status: dimsStatus } = useApi('ai-usage-dims', '/api/ai-usage/breakdown', () => ({ ...query.value, by: tab.value }))
const { data: anomalies } = useApi('ai-usage-anomalies', '/api/ai-usage/anomalies', () => query.value, { lazy: true })

// Журнал — курсорная подгрузка
const events = ref<any[]>([])
const eventsCursor = ref<string | null>(null)
const eventsLoading = ref(false)
async function loadEvents(reset = false) {
  if (eventsLoading.value) return
  eventsLoading.value = true
  try {
    const eventsUrl: string = '/api/ai-usage/events'
    const res: any = await $fetch(eventsUrl, {
      query: { ...query.value, limit: 50, ...(reset || !eventsCursor.value ? {} : { cursor: eventsCursor.value }) },
    })
    events.value = reset ? res.items : [...events.value, ...res.items]
    eventsCursor.value = res.nextCursor
  }
  catch {
    if (reset) events.value = []
  }
  finally {
    eventsLoading.value = false
  }
}
watch(query, () => loadEvents(true), { deep: true })
onMounted(() => loadEvents(true))

// ── Единицы ──────────────────────────────────────────────────────
const canViewCosts = computed(() => !!summary.value?.canViewCosts)
const { unit, money, tokens, unitOptions } = useAiUsageMoney({
  baseCurrency: computed(() => summary.value?.currency as AiCurrency | undefined),
  usdRubRate: computed(() => summary.value?.usdRubRate as number | undefined),
})
const showMoney = computed(() => canViewCosts.value && unit.value !== 'tokens')
/** Главное значение строки: деньги или токены. */
function mainValue(r: { cost?: number; inputTokens?: number; outputTokens?: number }) {
  return showMoney.value ? money(r.cost) : tokens((r.inputTokens ?? 0) + (r.outputTokens ?? 0))
}

// ── Дерево операций ──────────────────────────────────────────────
const expanded = ref<Set<string>>(new Set())
const opTree = computed(() => {
  const rows: any[] = ops.value?.rows ?? []
  const groups = new Map<string, { feature: string; label: string; rows: any[]; cost: number; calls: number; traces: number; inputTokens: number; outputTokens: number; errors: number }>()
  for (const r of rows) {
    const f = String(r.feature ?? 'unattributed')
    let g = groups.get(f)
    if (!g) {
      g = { feature: f, label: String(r.featureLabel ?? f), rows: [], cost: 0, calls: 0, traces: 0, inputTokens: 0, outputTokens: 0, errors: 0 }
      groups.set(f, g)
    }
    g.rows.push(r)
    g.cost += r.cost ?? 0
    g.calls += r.calls
    g.traces += r.traces
    g.inputTokens += r.inputTokens
    g.outputTokens += r.outputTokens
    g.errors += r.errors
  }
  const total = ops.value?.totalCost ?? 0
  return [...groups.values()]
    .map(g => ({ ...g, share: total > 0 ? g.cost / total : 0 }))
    .sort((a, b) => (showMoney.value ? b.cost - a.cost : (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens)))
})
function toggle(f: string) {
  const s = new Set(expanded.value)
  if (s.has(f)) s.delete(f)
  else s.add(f)
  expanded.value = s
}
watch(opTree, (t) => { if (t.length && !expanded.value.size) expanded.value = new Set(t.slice(0, 2).map(g => g.feature)) }, { immediate: true })

// ── График ───────────────────────────────────────────────────────
const chartOption = computed(() => {
  const s = series.value
  if (!s?.buckets?.length) return {}
  const base = baseCartesianOption(isDark.value)
  const useCost = showMoney.value
  return {
    ...base,
    legend: { ...base.legend, type: 'scroll' as const, top: 0, left: 0, right: 'auto' },
    grid: { ...base.grid, top: 36 },
    tooltip: {
      ...base.tooltip,
      valueFormatter: (v: number) => (useCost ? money(v) : tokens(v)),
    },
    xAxis: {
      type: 'category',
      data: s.buckets.map((b: string) => new Date(`${b}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })),
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => (useCost ? money(v) : tokens(v)) },
    },
    series: s.series.map((x: any) => ({
      name: x.label,
      type: 'bar',
      stack: 'total',
      barMaxWidth: 28,
      itemStyle: { color: x.color },
      // В валюте — исходные суммы в базовой валюте; money() сам пересчитает для подписи.
      data: useCost ? x.cost : x.tokens,
    })),
  }
})

// ── Фильтр-чипы ──────────────────────────────────────────────────
const filterLabels = ref<Record<string, string>>({})
function filterBy(key: 'model' | 'userId' | 'jobId' | 'trigger' | 'aiConfigId' | 'operation' | 'feature', value: string, label: string) {
  if (!value) return
  filterLabels.value = { ...filterLabels.value, [key]: label }
  setFilter(key, value)
}
const chips = computed(() => {
  const f = filters.value
  const out: Array<{ key: any; label: string }> = []
  if (f.feature) out.push({ key: 'feature', label: `Фича: ${AI_FEATURE_LABELS[f.feature as AiFeature] ?? f.feature}` })
  if (f.operation) out.push({ key: 'operation', label: `Операция: ${filterLabels.value.operation ?? f.operation}` })
  if (f.model) out.push({ key: 'model', label: `Модель: ${f.model}` })
  if (f.userId) out.push({ key: 'userId', label: `Сотрудник: ${filterLabels.value.userId ?? '…'}` })
  if (f.jobId) out.push({ key: 'jobId', label: `Вакансия: ${filterLabels.value.jobId ?? '…'}` })
  if (f.trigger) out.push({ key: 'trigger', label: `Запуск: ${AI_TRIGGER_LABELS[f.trigger as keyof typeof AI_TRIGGER_LABELS] ?? f.trigger}` })
  if (f.status) out.push({ key: 'status', label: `Статус: ${AI_STATUS_LABELS[f.status as AiUsageStatus] ?? f.status}` })
  if (f.aiConfigId) out.push({ key: 'aiConfigId', label: `Конфигурация: ${filterLabels.value.aiConfigId ?? '…'}` })
  if (f.entityId) out.push({ key: 'entityId', label: `Объект: ${f.entityType === 'candidate' ? 'кандидат' : (f.entityType ?? '')} ${f.entityId.slice(0, 8)}…` })
  return out
})

const featureOptions = [{ value: '', label: 'Все фичи' }, ...AI_FEATURES.map(f => ({ value: f, label: AI_FEATURE_LABELS[f] }))]
const triggerOptions = [{ value: '', label: 'Любой запуск' }, ...AI_TRIGGERS.map(t => ({ value: t, label: AI_TRIGGER_LABELS[t] }))]
const statusOptions = [{ value: '', label: 'Любой статус' }, ...AI_STATUSES.map(s => ({ value: s, label: AI_STATUS_LABELS[s] }))]

const period = computed<AiUsagePeriod>({
  get: () => (filters.value.period as AiUsagePeriod) ?? '30d',
  set: v => setFilter('period', v),
})

// ── Drawers ──────────────────────────────────────────────────────
const traceId = ref<string | null>(null)
const operationKey = ref<string | null>(null)
function openTrace(id: string) { traceId.value = id }
function openOperation(key: string) { traceId.value = null; operationKey.value = key }

// ── Экспорт ──────────────────────────────────────────────────────
function exportHref(kind: 'events' | 'breakdown', by = 'operation') {
  const q = new URLSearchParams({ ...query.value, kind, by })
  return `/api/ai-usage/export.csv?${q.toString()}`
}

// ── Бюджеты ──────────────────────────────────────────────────────
const budgetAlerts = computed(() => (summary.value?.budgets ?? []).filter((b: any) => b.pct >= 80))

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'model', label: 'Модели' },
  { key: 'user', label: 'Сотрудники' },
  { key: 'job', label: 'Вакансии' },
  { key: 'trigger', label: 'Запуск' },
  { key: 'config', label: 'Конфигурации' },
]
const dimRows = computed<any[]>(() => dims.value?.rows ?? [])
function onDimClick(r: any) {
  if (!r.key) return
  if (tab.value === 'model') filterBy('model', r.key, r.label)
  else if (tab.value === 'user') filterBy('userId', r.key, r.label)
  else if (tab.value === 'job') filterBy('jobId', r.key, r.label)
  else if (tab.value === 'trigger') filterBy('trigger', r.key, r.label)
  else if (tab.value === 'config') filterBy('aiConfigId', r.key, r.label)
}

const s = computed(() => summary.value ?? {})
const changeUp = computed(() => (s.value.costChangePct ?? 0) > 0)
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-6">
    <!-- Заголовок -->
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Coins class="size-6 text-brand-500" /> Расход ИИ
        </h1>
        <p class="mt-1 text-sm text-surface-500">
          Сколько стоит каждое ИИ-действие: по операциям, моделям, сотрудникам и вакансиям.
          <template v-if="s.scope === 'own'"> Показаны только ваши вызовы.</template>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UiSegmented v-if="canViewCosts" v-model="unit" :options="unitOptions" size="sm" aria-label="Единицы" />
        <a
          v-if="s.canExport" :href="exportHref('events')"
          class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ring-1 ring-surface-200 dark:ring-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800"
        ><Download class="size-4" /> CSV</a>
        <NuxtLink
          v-if="s.canManageBudgets" to="/dashboard/settings/ai?tab=budget"
          class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ring-1 ring-surface-200 dark:ring-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800"
        ><Settings class="size-4" /> Бюджет и валюта</NuxtLink>
      </div>
    </div>

    <div v-if="!canSee" class="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-4 text-sm">Нет доступа к разделу «Расход ИИ».</div>

    <template v-else>
      <!-- Фильтры -->
      <div class="flex flex-wrap items-center gap-2">
        <UiSegmented v-model="period" :options="AI_USAGE_PERIOD_OPTIONS" size="sm" aria-label="Период" />
        <div class="w-44"><UiSelect :model-value="filters.feature ?? ''" :options="featureOptions" size="sm" @update:model-value="v => setFilter('feature', String(v ?? ''))" /></div>
        <div class="w-40"><UiSelect :model-value="filters.trigger ?? ''" :options="triggerOptions" size="sm" @update:model-value="v => setFilter('trigger', String(v ?? ''))" /></div>
        <div class="w-40"><UiSelect :model-value="filters.status ?? ''" :options="statusOptions" size="sm" @update:model-value="v => setFilter('status', String(v ?? ''))" /></div>
        <span
          v-for="c in chips.filter(c => !['feature', 'trigger', 'status'].includes(c.key))" :key="c.key"
          class="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-950/50 px-2.5 py-1 text-xs text-brand-700 dark:text-brand-300"
        >
          {{ c.label }}
          <button type="button" class="hover:text-brand-900" :aria-label="`Убрать фильтр ${c.label}`" @click="c.key === 'entityId' ? setFilters({ entityId: '', entityType: '' }) : setFilter(c.key, null)"><X class="size-3" /></button>
        </span>
        <button v-if="activeCount" type="button" class="text-xs text-surface-500 hover:text-surface-800 inline-flex items-center gap-1" @click="resetFilters()">
          <Filter class="size-3" /> Сбросить
        </button>
      </div>

      <div v-if="summaryError" class="rounded-xl bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-700">
        Не удалось загрузить данные. <button class="underline" @click="refreshSummary()">Повторить</button>
      </div>

      <!-- Баннер бюджета -->
      <div
        v-for="b in budgetAlerts" :key="b.id"
        class="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-sm"
        :class="b.pct >= 100 ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'"
      >
        <AlertTriangle class="size-4 shrink-0" />
        <span class="font-medium">{{ b.pct >= 100 ? 'Бюджет исчерпан' : `Израсходовано ${Math.round(b.pct)} % бюджета` }}: {{ b.label }}</span>
        <span class="tabular-nums">{{ money(b.spent) }} из {{ money(b.limit) }}</span>
        <span v-if="b.forecast" class="tabular-nums opacity-80">прогноз {{ money(b.forecast) }}</span>
        <span v-if="b.pct >= 100 && b.onExceed === 'block_background'" class="opacity-80">фоновые задачи приостановлены</span>
      </div>

      <!-- KPI -->
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div class="rounded-2xl bg-white dark:bg-surface-900 ring-1 ring-surface-950/[0.05] dark:ring-white/[0.06] p-4 col-span-2 lg:col-span-1">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-surface-500">{{ showMoney ? 'Расход' : 'Токены' }}</div>
          <div class="mt-1 text-3xl font-black tabular-nums">
            <template v-if="summaryStatus === 'pending' && !summary">…</template>
            <template v-else>{{ showMoney ? money(s.cost) : tokens((s.inputTokens ?? 0) + (s.outputTokens ?? 0)) }}</template>
          </div>
          <div v-if="showMoney && s.costChangePct !== null && s.costChangePct !== undefined" class="mt-1 text-xs inline-flex items-center gap-1" :class="changeUp ? 'text-red-600' : 'text-emerald-600'">
            <component :is="changeUp ? TrendingUp : TrendingDown" class="size-3" />
            {{ changeUp ? '+' : '' }}{{ formatPct(s.costChangePct) }} к прошлому периоду
          </div>
          <div v-if="s.rateIsDefault && showMoney" class="mt-1 text-[11px] text-surface-400">курс USD по умолчанию — задайте в настройках</div>
        </div>
        <div v-if="showMoney" class="rounded-2xl bg-white dark:bg-surface-900 ring-1 ring-surface-950/[0.05] dark:ring-white/[0.06] p-4">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Прогноз на месяц</div>
          <div class="mt-1 text-2xl font-bold tabular-nums">{{ money(s.forecast) }}</div>
          <div class="mt-1 text-xs text-surface-500">по темпу последних 7 дней</div>
        </div>
        <div class="rounded-2xl bg-white dark:bg-surface-900 ring-1 ring-surface-950/[0.05] dark:ring-white/[0.06] p-4">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-surface-500 flex items-center gap-1"><Zap class="size-3" /> Вызовов</div>
          <div class="mt-1 text-2xl font-bold tabular-nums">{{ (s.calls ?? 0).toLocaleString('ru-RU') }}</div>
          <div class="mt-1 text-xs text-surface-500">действий {{ (s.traces ?? 0).toLocaleString('ru-RU') }}</div>
        </div>
        <div v-if="showMoney" class="rounded-2xl bg-white dark:bg-surface-900 ring-1 ring-surface-950/[0.05] dark:ring-white/[0.06] p-4">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-surface-500 flex items-center gap-1"><Gauge class="size-3" /> Цена действия</div>
          <div class="mt-1 text-2xl font-bold tabular-nums">{{ money(s.avgCostPerTrace) }}</div>
          <div v-if="s.topFeature" class="mt-1 text-xs text-surface-500">больше всего — {{ s.topFeature.label }} ({{ formatPct(s.topFeature.share) }})</div>
        </div>
        <div class="rounded-2xl bg-white dark:bg-surface-900 ring-1 ring-surface-950/[0.05] dark:ring-white/[0.06] p-4">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-surface-500 flex items-center gap-1"><AlertTriangle class="size-3" /> Потери</div>
          <div class="mt-1 text-2xl font-bold tabular-nums">{{ showMoney ? money(s.lossCost) : formatPct(s.errorShare, 1) }}</div>
          <div class="mt-1 text-xs text-surface-500">ошибок {{ s.errors ?? 0 }}<template v-if="showMoney"> · {{ formatPct(s.lossShare, 1) }} расхода</template></div>
        </div>
      </div>

      <div v-if="s.noPriceCalls || s.unattributedCalls || s.estimatedCalls" class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-surface-500">
        <span v-if="s.noPriceCalls" class="inline-flex items-center gap-1"><Info class="size-3" /> {{ s.noPriceCalls }} вызовов без цены — укажите цены в <NuxtLink to="/dashboard/settings/ai" class="underline">настройках ИИ</NuxtLink></span>
        <span v-if="s.estimatedCalls" class="inline-flex items-center gap-1"><Info class="size-3" /> {{ s.estimatedCalls }} вызовов с оценкой токенов (провайдер не вернул usage)</span>
        <span v-if="s.unattributedCalls" class="inline-flex items-center gap-1"><Info class="size-3" /> {{ s.unattributedCalls }} вызовов без атрибуции</span>
      </div>

      <!-- Динамика -->
      <section class="rounded-2xl bg-white dark:bg-surface-900 ring-1 ring-surface-950/[0.05] dark:ring-white/[0.06] p-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 class="text-sm font-semibold flex items-center gap-1.5"><Activity class="size-4" /> Динамика</h2>
          <UiSegmented
            v-model="chartGroup" size="sm" aria-label="Группировка графика"
            :options="[{ value: 'feature', label: 'Фичи' }, { value: 'model', label: 'Модели' }, { value: 'trigger', label: 'Запуск' }]"
          />
        </div>
        <ClientOnly>
          <AnalyticsAeChart v-if="series?.buckets?.length" :option="chartOption" :height="280" :loading="seriesStatus === 'pending'" />
          <div v-else class="h-[280px] grid place-items-center text-sm text-surface-500">Нет вызовов за период</div>
        </ClientOnly>
      </section>

      <!-- Операции -->
      <section class="rounded-2xl bg-white dark:bg-surface-900 ring-1 ring-surface-950/[0.05] dark:ring-white/[0.06] overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3">
          <h2 class="text-sm font-semibold">Операции</h2>
          <a v-if="s.canExport" :href="exportHref('breakdown', 'operation')" class="text-xs text-surface-500 hover:text-surface-800 inline-flex items-center gap-1"><Download class="size-3" /> CSV</a>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-surface-50 dark:bg-surface-800/50 text-xs text-surface-500">
              <tr>
                <th class="text-left px-4 py-2 font-medium">Фича / операция</th>
                <th class="text-right px-3 py-2 font-medium">Вызовов</th>
                <th class="text-right px-3 py-2 font-medium hidden md:table-cell">Действий</th>
                <th class="text-right px-3 py-2 font-medium hidden md:table-cell">Вход / выход</th>
                <th class="text-right px-3 py-2 font-medium">{{ showMoney ? 'Расход' : 'Токены' }}</th>
                <th v-if="showMoney" class="text-right px-3 py-2 font-medium hidden sm:table-cell">Доля</th>
                <th v-if="showMoney" class="text-right px-3 py-2 font-medium hidden lg:table-cell">За действие</th>
                <th class="text-right px-4 py-2 font-medium hidden lg:table-cell">Ошибки</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="opsStatus === 'pending' && !ops"><td colspan="8" class="px-4 py-6 text-center text-surface-500">Загрузка…</td></tr>
              <tr v-else-if="!opTree.length"><td colspan="8" class="px-4 py-6 text-center text-surface-500">Нет вызовов за период</td></tr>
              <template v-for="g in opTree" :key="g.feature">
                <tr class="border-t border-surface-100 dark:border-surface-800 bg-surface-50/40 dark:bg-surface-800/20 cursor-pointer" @click="toggle(g.feature)">
                  <td class="px-4 py-2 font-medium">
                    <span class="inline-flex items-center gap-1">
                      <component :is="expanded.has(g.feature) ? ChevronDown : ChevronRight" class="size-4 text-surface-400" />
                      {{ g.label }}
                      <span class="text-xs text-surface-400 font-normal">({{ g.rows.length }})</span>
                    </span>
                  </td>
                  <td class="text-right px-3 tabular-nums">{{ g.calls }}</td>
                  <td class="text-right px-3 tabular-nums hidden md:table-cell">{{ g.traces }}</td>
                  <td class="text-right px-3 tabular-nums hidden md:table-cell text-surface-500">{{ tokens(g.inputTokens) }} / {{ tokens(g.outputTokens) }}</td>
                  <td class="text-right px-3 tabular-nums font-semibold">{{ mainValue(g) }}</td>
                  <td v-if="showMoney" class="text-right px-3 tabular-nums hidden sm:table-cell">{{ formatPct(g.share) }}</td>
                  <td v-if="showMoney" class="text-right px-3 tabular-nums hidden lg:table-cell">{{ money(g.traces ? g.cost / g.traces : null) }}</td>
                  <td class="text-right px-4 tabular-nums hidden lg:table-cell">{{ g.errors || '' }}</td>
                </tr>
                <template v-if="expanded.has(g.feature)">
                  <tr
                    v-for="r in g.rows" :key="r.key"
                    class="border-t border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/40 cursor-pointer"
                    @click="openOperation(r.key)"
                  >
                    <td class="pl-10 pr-4 py-2">
                      <div>{{ r.label }}</div>
                      <div class="text-[11px] text-surface-400"><code class="font-mono">{{ r.topModel }}</code><template v-if="r.lengthCut"> · {{ r.lengthCut }} обрезано лимитом</template></div>
                    </td>
                    <td class="text-right px-3 tabular-nums">{{ r.calls }}</td>
                    <td class="text-right px-3 tabular-nums hidden md:table-cell">{{ r.traces }}</td>
                    <td class="text-right px-3 tabular-nums hidden md:table-cell text-surface-500">{{ tokens(r.inputTokens) }} / {{ tokens(r.outputTokens) }}</td>
                    <td class="text-right px-3 tabular-nums">{{ mainValue(r) }}</td>
                    <td v-if="showMoney" class="text-right px-3 tabular-nums hidden sm:table-cell">{{ formatPct(r.share) }}</td>
                    <td v-if="showMoney" class="text-right px-3 tabular-nums hidden lg:table-cell">{{ money(r.avgCostPerTrace) }}</td>
                    <td class="text-right px-4 tabular-nums hidden lg:table-cell" :class="r.errorRate > 0.1 ? 'text-red-600' : ''">{{ r.errors ? formatPct(r.errorRate, 1) : '' }}</td>
                  </tr>
                </template>
              </template>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Разрезы -->
      <section class="rounded-2xl bg-white dark:bg-surface-900 ring-1 ring-surface-950/[0.05] dark:ring-white/[0.06] overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div class="flex flex-wrap gap-1">
            <button
              v-for="t in tabs" :key="t.key" type="button"
              class="rounded-lg px-3 py-1.5 text-sm"
              :class="tab === t.key ? 'bg-brand-500 text-white' : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'"
              @click="tab = t.key"
            >{{ t.label }}</button>
          </div>
          <a v-if="s.canExport" :href="exportHref('breakdown', tab)" class="text-xs text-surface-500 hover:text-surface-800 inline-flex items-center gap-1"><Download class="size-3" /> CSV</a>
        </div>
        <div v-for="h in dims?.hints ?? []" :key="h.text" class="mx-4 mb-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          {{ h.text }}<template v-if="h.saving"> — экономия ≈ {{ money(h.saving) }} в месяц</template>.
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-surface-50 dark:bg-surface-800/50 text-xs text-surface-500">
              <tr>
                <th class="text-left px-4 py-2 font-medium">{{ tabs.find(t => t.key === tab)?.label }}</th>
                <th class="text-right px-3 py-2 font-medium">Вызовов</th>
                <th class="text-right px-3 py-2 font-medium">{{ showMoney ? 'Расход' : 'Токены' }}</th>
                <th v-if="showMoney" class="text-right px-3 py-2 font-medium hidden sm:table-cell">Доля</th>
                <th v-if="tab === 'model'" class="text-right px-3 py-2 font-medium hidden md:table-cell">{{ showMoney ? 'За 1 тыс. токенов' : 'Размышления' }}</th>
                <th v-if="tab === 'user'" class="text-left px-3 py-2 font-medium hidden md:table-cell">Топ операций</th>
                <th v-if="tab === 'user'" class="text-right px-3 py-2 font-medium hidden md:table-cell">Фон</th>
                <th v-if="tab === 'job'" class="text-right px-3 py-2 font-medium hidden md:table-cell">Откликов</th>
                <th v-if="tab === 'job' && showMoney" class="text-right px-3 py-2 font-medium hidden md:table-cell">На отклик</th>
                <th v-if="tab === 'job' && showMoney" class="text-right px-3 py-2 font-medium hidden lg:table-cell">На найм</th>
                <th class="text-right px-4 py-2 font-medium hidden lg:table-cell">Ср. время</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="dimsStatus === 'pending' && !dims"><td colspan="9" class="px-4 py-6 text-center text-surface-500">Загрузка…</td></tr>
              <tr v-else-if="!dimRows.length"><td colspan="9" class="px-4 py-6 text-center text-surface-500">Нет данных</td></tr>
              <tr
                v-for="r in dimRows" :key="r.key"
                class="border-t border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/40"
                :class="r.key ? 'cursor-pointer' : ''"
                :title="r.key ? 'Отфильтровать дашборд' : ''"
                @click="onDimClick(r)"
              >
                <td class="px-4 py-2">
                  <span :class="tab === 'model' ? 'font-mono text-xs' : ''">{{ r.label }}</span>
                  <span v-if="tab === 'model' && r.provider" class="ml-2 text-xs text-surface-400">{{ r.provider }}</span>
                </td>
                <td class="text-right px-3 tabular-nums">{{ r.calls }}</td>
                <td class="text-right px-3 tabular-nums font-medium">{{ mainValue(r) }}</td>
                <td v-if="showMoney" class="text-right px-3 tabular-nums hidden sm:table-cell">{{ formatPct(r.share) }}</td>
                <td v-if="tab === 'model'" class="text-right px-3 tabular-nums hidden md:table-cell">{{ showMoney ? money(r.costPer1kTokens) : formatPct(r.reasoningShare) }}</td>
                <td v-if="tab === 'user'" class="px-3 hidden md:table-cell text-xs text-surface-500">{{ (r.topOperations ?? []).map((o: any) => o.label).join(', ') }}</td>
                <td v-if="tab === 'user'" class="text-right px-3 tabular-nums hidden md:table-cell">{{ formatPct(r.backgroundShare) }}</td>
                <td v-if="tab === 'job'" class="text-right px-3 tabular-nums hidden md:table-cell">{{ r.applications ?? '' }}<template v-if="r.hired"> · найм {{ r.hired }}</template></td>
                <td v-if="tab === 'job' && showMoney" class="text-right px-3 tabular-nums hidden md:table-cell">{{ money(r.costPerApplication) }}</td>
                <td v-if="tab === 'job' && showMoney" class="text-right px-3 tabular-nums hidden lg:table-cell">{{ money(r.costPerHire) }}</td>
                <td class="text-right px-4 tabular-nums hidden lg:table-cell text-surface-500">{{ formatDuration(r.avgDurationMs) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Потери и аномалии -->
      <section v-if="anomalies && (anomalies.pricier?.length || anomalies.errorOps?.length || anomalies.lengthOps?.length || anomalies.expensive?.length)" class="grid lg:grid-cols-2 gap-4">
        <div class="rounded-2xl bg-white dark:bg-surface-900 ring-1 ring-surface-950/[0.05] dark:ring-white/[0.06] p-4">
          <h2 class="text-sm font-semibold mb-3">Самые дорогие вызовы</h2>
          <ul class="divide-y divide-surface-100 dark:divide-surface-800 text-sm">
            <li v-for="x in anomalies.expensive" :key="x.id" class="py-1.5 flex items-center gap-3 cursor-pointer hover:text-brand-600" @click="openTrace(x.traceId)">
              <span class="flex-1 min-w-0 truncate">{{ x.label }} <span class="text-xs text-surface-400">· {{ x.userName ?? 'Система' }}</span></span>
              <span class="text-xs text-surface-500 tabular-nums">{{ tokens(x.inputTokens + x.outputTokens) }}</span>
              <span v-if="showMoney" class="tabular-nums font-medium">{{ money(x.cost) }}</span>
            </li>
          </ul>
        </div>
        <div class="rounded-2xl bg-white dark:bg-surface-900 ring-1 ring-surface-950/[0.05] dark:ring-white/[0.06] p-4 space-y-4">
          <div v-if="anomalies.pricier?.length">
            <h2 class="text-sm font-semibold mb-2">Подорожали к прошлому периоду</h2>
            <ul class="space-y-2 text-sm">
              <li v-for="p in anomalies.pricier" :key="p.operation" class="cursor-pointer" @click="openOperation(p.operation)">
                <div class="flex justify-between gap-2"><span>{{ p.label }}</span><b class="text-red-600 tabular-nums">×{{ p.ratio.toFixed(1) }}</b></div>
                <div class="text-xs text-surface-500">{{ p.reasons.join('; ') }}</div>
              </li>
            </ul>
          </div>
          <div v-if="anomalies.errorOps?.length">
            <h2 class="text-sm font-semibold mb-2">Много ошибок</h2>
            <ul class="space-y-1 text-sm">
              <li v-for="p in anomalies.errorOps" :key="p.operation" class="flex justify-between cursor-pointer" @click="setFilters({ operation: p.operation, status: 'error' })">
                <span>{{ p.label }}</span><span class="text-red-600 tabular-nums">{{ formatPct(p.errorRate) }} из {{ p.calls }}</span>
              </li>
            </ul>
          </div>
          <div v-if="anomalies.lengthOps?.length">
            <h2 class="text-sm font-semibold mb-2">Упёрлись в лимит токенов</h2>
            <p class="text-xs text-surface-500 mb-1">Ответ обрезан — часто приводит к повтору и двойной оплате. Проверьте max tokens конфигурации.</p>
            <ul class="space-y-1 text-sm">
              <li v-for="p in anomalies.lengthOps" :key="p.operation" class="flex justify-between cursor-pointer" @click="openOperation(p.operation)">
                <span>{{ p.label }}</span><span class="tabular-nums">{{ p.lengthCut }} из {{ p.calls }}<template v-if="showMoney"> · {{ money(p.lengthCost) }}</template></span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- Журнал -->
      <section class="rounded-2xl bg-white dark:bg-surface-900 ring-1 ring-surface-950/[0.05] dark:ring-white/[0.06] overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3">
          <h2 class="text-sm font-semibold flex items-center gap-1.5"><Clock class="size-4" /> Журнал вызовов</h2>
          <span class="text-xs text-surface-500">Тексты промптов и ответов не хранятся — только метрики</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-surface-50 dark:bg-surface-800/50 text-xs text-surface-500">
              <tr>
                <th class="text-left px-4 py-2 font-medium">Время</th>
                <th class="text-left px-3 py-2 font-medium">Операция</th>
                <th class="text-left px-3 py-2 font-medium hidden md:table-cell">Кто / где</th>
                <th class="text-left px-3 py-2 font-medium hidden lg:table-cell">Модель</th>
                <th class="text-right px-3 py-2 font-medium">Токены</th>
                <th v-if="showMoney" class="text-right px-3 py-2 font-medium">Стоимость</th>
                <th class="text-right px-3 py-2 font-medium hidden sm:table-cell">Время</th>
                <th class="text-right px-4 py-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!events.length && !eventsLoading"><td colspan="8" class="px-4 py-6 text-center text-surface-500">Нет вызовов</td></tr>
              <tr
                v-for="r in events" :key="r.id"
                class="border-t border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/40 cursor-pointer"
                @click="openTrace(r.traceId)"
              >
                <td class="px-4 py-2 text-xs text-surface-500 tabular-nums whitespace-nowrap">{{ formatDateTimeRu(r.createdAt) }}</td>
                <td class="px-3 py-2">{{ r.label }}<span v-if="r.stepNo > 1" class="ml-1 text-[11px] text-surface-400">шаг {{ r.stepNo }}</span></td>
                <td class="px-3 py-2 hidden md:table-cell text-xs">
                  {{ r.userName ?? (r.trigger === 'background' ? 'Фон' : 'Система') }}
                  <span v-if="r.jobTitle" class="text-surface-400"> · {{ r.jobTitle }}</span>
                </td>
                <td class="px-3 py-2 hidden lg:table-cell"><code class="font-mono text-xs">{{ r.model }}</code></td>
                <td class="px-3 py-2 text-right tabular-nums text-xs">
                  {{ tokens(r.inputTokens + r.outputTokens) }}<span v-if="r.tokensEstimated" class="text-surface-400" title="оценка">≈</span>
                </td>
                <td v-if="showMoney" class="px-3 py-2 text-right tabular-nums">{{ money(r.cost) }}</td>
                <td class="px-3 py-2 text-right tabular-nums text-xs hidden sm:table-cell">{{ formatDuration(r.durationMs) }}</td>
                <td class="px-4 py-2 text-right text-xs" :class="AI_STATUS_TONE[r.status]">{{ AI_STATUS_LABELS[r.status as AiUsageStatus] ?? r.status }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="eventsCursor || eventsLoading" class="px-4 py-3 border-t border-surface-100 dark:border-surface-800 text-center">
          <button type="button" class="text-sm text-brand-600 hover:underline disabled:opacity-50" :disabled="eventsLoading" @click="loadEvents()">
            {{ eventsLoading ? 'Загрузка…' : 'Показать ещё' }}
          </button>
        </div>
      </section>
    </template>

    <AiUsageTraceDrawer :trace-id="traceId" :money="money" :tokens="tokens" :can-view-costs="showMoney" @close="traceId = null" @open-operation="openOperation" />
    <AiUsageOperationDrawer
      :operation-key="operationKey" :filters="filters" :money="money" :tokens="tokens" :can-view-costs="showMoney"
      @close="operationKey = null" @open-trace="(id) => { operationKey = null; openTrace(id) }"
    />
  </div>
</template>
