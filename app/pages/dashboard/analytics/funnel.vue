<script setup lang="ts">
import {
  ChartNoAxesCombined, AlertCircle, RefreshCw,
  ChevronLeft, ChevronRight, X, UserX,
} from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Аналитика подбора — Воронка',
  description: 'Воронка найма по этапам: конверсии, время на этапе, отсеянные кандидаты',
})

const localePath = useLocalePath()
const { formatPersonName, formatDateTime } = useOrgSettings()

// ─────────────────────────────────────────────
// Фильтры
// ─────────────────────────────────────────────

import { useAnalyticsFilters } from '~/composables/useAnalyticsFilters'

const { query } = useAnalyticsFilters()
const pipelineId = ref<string | undefined>(undefined)

const { data: pipelinesData } = useFetch('/api/pipelines', {
  key: 'analytics-pipelines',
  headers: useRequestHeaders(['cookie']),
})
const pipelines = computed(() => (pipelinesData.value as any) ?? [])

const funnelQuery = computed(() => {
  const q = { ...query.value }
  delete q.compare
  if (pipelineId.value) q.pipelineId = pipelineId.value
  return q
})

// ─────────────────────────────────────────────
// Воронка
// ─────────────────────────────────────────────

const { data: funnel, status: funnelStatus, error: funnelError, refresh: refreshFunnel } = useFetch('/api/analytics/funnel', {
  key: 'analytics-funnel',
  headers: useRequestHeaders(['cookie']),
  query: funnelQuery,
})

const isLoading = computed(() => funnelStatus.value === 'pending' && !funnel.value)
const stages = computed(() => (funnel.value as any)?.stages ?? [])
const transitions = computed(() => (funnel.value as any)?.transitions ?? [])

const refreshedAtLabel = computed(() => {
  const iso = (funnel.value as any)?.refreshedAt
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
})

const cohortSize = computed(() => (funnel.value as any)?.cohortSize ?? 0)

const maxReached = computed(() =>
  Math.max(1, ...stages.value.map((s: any) => s.reached ?? 0)),
)

function barWidth(reached: number) {
  return `${Math.max(2, Math.round((reached / maxReached.value) * 100))}%`
}

function fmtHours(hours: number | null) {
  if (hours == null) return '—'
  if (hours >= 48) return `${Math.round((hours / 24) * 10) / 10} дн`
  return `${Math.round(hours * 10) / 10} ч`
}

function fmtPct(v: number | null) {
  return v != null ? `${Math.round(v * 100)}%` : '—'
}

// ─────────────────────────────────────────────
// Drill-down отсеянных
// ─────────────────────────────────────────────

const dropoffStage = ref<{ id: string, name: string } | null>(null)
const dropoffPage = ref(1)

function openDropoff(stage: any) {
  if (dropoffStage.value?.id === stage.id) {
    dropoffStage.value = null
    return
  }
  dropoffPage.value = 1
  dropoffStage.value = { id: stage.id, name: stage.name }
}

const { data: dropoff, status: dropoffStatus, refresh: fetchDropoff } = useFetch('/api/analytics/funnel/dropoff', {
  key: 'analytics-dropoff',
  headers: useRequestHeaders(['cookie']),
  query: computed(() => ({
    ...funnelQuery.value,
    stageId: dropoffStage.value?.id ?? '',
    page: String(dropoffPage.value),
    limit: '25',
  })),
  immediate: false,
  watch: false,
})

watch([dropoffStage, dropoffPage, funnelQuery], () => {
  if (dropoffStage.value) fetchDropoff()
})

const dropoffItems = computed(() => (dropoff.value as any)?.items ?? [])
const dropoffTotal = computed(() => (dropoff.value as any)?.total ?? 0)
const dropoffPages = computed(() => Math.max(1, Math.ceil(dropoffTotal.value / 25)))

// ─────────────────────────────────────────────
// Sankey-диаграмма переходов (Фаза 4)
// ─────────────────────────────────────────────

import { baseCartesianOption, CHART_SEMANTIC, CHART_PALETTE, formatTrendLabel } from '~/utils/analytics/chart-theme'

const { isDark } = useColorMode()

const hasTransitions = computed(() => transitions.value.length > 0)

const sankeyOption = computed(() => {
  if (!hasTransitions.value) return {}
  const nodeSet = new Set<string>()
  for (const t of transitions.value) {
    nodeSet.add(t.fromName)
    nodeSet.add(t.toName)
  }
  const nodes = [...nodeSet].map((name, i) => ({
    name,
    itemStyle: { color: CHART_PALETTE[i % CHART_PALETTE.length] },
  }))
  const links = transitions.value
    .filter((t: any) => t.fromName !== t.toName)
    .map((t: any) => ({
      source: t.fromName,
      target: t.toName,
      value: t.count,
      lineStyle: { color: 'gradient', opacity: 0.4 },
    }))
  const c = isDark.value
    ? { text: '#e4e4e7', bg: '#18181b', border: '#3f3f46' }
    : { text: '#3f3f46', bg: '#ffffff', border: '#e4e4e7' }
  return {
    tooltip: { trigger: 'item', backgroundColor: c.bg, borderColor: c.border, textStyle: { color: c.text, fontSize: 12 } },
    series: [{
      type: 'sankey',
      data: nodes,
      links,
      emphasis: { focus: 'adjacency' },
      nodeAlign: 'left',
      nodeGap: 8,
      nodeWidth: 16,
      label: { color: c.text, fontSize: 11, formatter: (p: any) => p.name.length > 18 ? p.name.slice(0, 16) + '…' : p.name },
      lineStyle: { curveness: 0.5 },
    }],
  }
})

// ─────────────────────────────────────────────
// Тренд конверсий во времени (Фаза 4)
// ─────────────────────────────────────────────

const { data: funnelTrend, status: trendStatus } = useFetch('/api/analytics/funnel/trend', {
  key: 'analytics-funnel-trend',
  headers: useRequestHeaders(['cookie']),
  query: computed(() => ({ ...funnelQuery.value, groupBy: 'week' })),
})

const trendPoints = computed<any[]>(() => (funnelTrend.value as any)?.points ?? [])
const hasTrend = computed(() => trendPoints.value.length > 1)

/** Все имена этапов в тренде (для серий). */
const trendStageNames = computed(() => {
  const names = new Set<string>()
  for (const p of trendPoints.value) for (const s of p.stages ?? []) names.add(s.stageName)
  return [...names]
})

const trendChartOption = computed(() => {
  if (!hasTrend.value) return {}
  const base = baseCartesianOption(isDark.value)
  const labels = trendPoints.value.map(p => formatTrendLabel(p.bucket, 'week'))
  return {
    ...base,
    legend: { ...base.legend, type: 'scroll' as const, bottom: 0, top: 'auto' },
    grid: { ...base.grid, bottom: 40 },
    tooltip: { ...base.tooltip, trigger: 'axis' as const, valueFormatter: (v: any) => v != null ? `${Math.round(v * 100)}%` : '—' },
    xAxis: { type: 'category', data: labels, axisTick: { show: false } },
    yAxis: { type: 'value', min: 0, max: 1, axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` } },
    series: trendStageNames.value.map((name, i) => ({
      name,
      type: 'line',
      smooth: true,
      connectNulls: true,
      data: trendPoints.value.map(p => {
        const s = (p.stages ?? []).find((x: any) => x.stageName === name)
        return s?.conversionNext ?? null
      }),
      itemStyle: { color: CHART_PALETTE[i % CHART_PALETTE.length] },
      lineStyle: { color: CHART_PALETTE[i % CHART_PALETTE.length], width: 2 },
    })),
  }
})
</script>

<template>
  <div class="space-y-6">
    <!-- Заголовок + вкладки -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-950/60 flex items-center justify-center">
          <ChartNoAxesCombined class="w-5 h-5 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-50">Аналитика подбора</h1>
          <p v-if="refreshedAtLabel" class="text-xs text-surface-500 dark:text-surface-400 flex items-center gap-1">
            <RefreshCw class="w-3 h-3" /> данные на {{ refreshedAtLabel }}
          </p>
        </div>
      </div>
      <AnalyticsNav />
    </div>

    <!-- Фильтры (sticky) -->
    <AnalyticsFilterBar show-job show-source>
      <template #extra>
        <select
          v-model="pipelineId"
          class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs text-surface-700 dark:text-surface-300 max-w-56"
        >
          <option :value="undefined">Воронка по умолчанию</option>
          <option v-for="p in pipelines" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </template>
    </AnalyticsFilterBar>

    <!-- Ошибка -->
    <div
      v-if="funnelError"
      class="rounded-2xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/60 p-5 text-sm text-danger-700 dark:text-danger-400 flex items-center gap-3"
    >
      <AlertCircle class="w-5 h-5 shrink-0" />
      Не удалось загрузить воронку. <button class="underline" @click="refreshFunnel()">Повторить</button>
    </div>

    <!-- Скелетон -->
    <div v-else-if="isLoading" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 space-y-4 animate-pulse">
      <div v-for="i in 5" :key="i" class="h-12 bg-surface-100 dark:bg-surface-800/60 rounded-lg" />
    </div>

    <!-- Пустое состояние -->
    <div
      v-else-if="!stages.length"
      class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-10 text-center text-sm text-surface-400 dark:text-surface-500"
    >
      Нет данных за выбранный период — измените фильтры или подождите первого обновления аналитики
    </div>

    <template v-else>
      <!-- Воронка -->
      <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
        <div class="px-5 py-4 border-b border-surface-100 dark:border-surface-800 flex items-start justify-between gap-2">
          <div>
            <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Воронка по этапам</h2>
            <p class="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
              Когорта откликов периода. «Дошло» = сколько из них когда-либо достигли этапа. Конверсия = дошло дальше / дошло сюда.
            </p>
          </div>
          <span class="text-xs text-surface-500 dark:text-surface-400 tabular-nums shrink-0 whitespace-nowrap">
            когорта: {{ cohortSize }}
          </span>
        </div>
        <div class="p-5 space-y-3">
          <button
            v-for="stage in stages"
            :key="stage.id"
            class="w-full text-left group"
            @click="openDropoff(stage)"
          >
            <div class="flex items-center justify-between mb-1 gap-2">
              <span class="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
                {{ stage.name }}
                <span v-if="dropoffStage?.id === stage.id" class="text-primary-600 dark:text-primary-400 text-xs ml-1">— отсеянные ниже</span>
              </span>
              <span class="text-xs text-surface-400 dark:text-surface-500 tabular-nums shrink-0">
                сейчас: {{ stage.current }} (вне периода) · медиана: {{ fmtHours(stage.medianHours) }}
              </span>
            </div>
            <div class="relative h-9 rounded-lg bg-surface-100 dark:bg-surface-800 overflow-hidden">
              <div
                class="absolute inset-y-0 left-0 rounded-lg transition-all group-hover:opacity-90"
                :style="{ width: barWidth(stage.reached), backgroundColor: stage.color || '#3b82f6' }"
              />
              <div class="absolute inset-0 flex items-center justify-between px-3">
                <span class="text-xs font-semibold text-white mix-blend-difference tabular-nums">{{ stage.reached }} дошло</span>
                <span class="text-xs text-surface-500 dark:text-surface-400 tabular-nums">
                  дальше: {{ fmtPct(stage.conversionNext) }} · от старта: {{ fmtPct(stage.conversionFromStart) }}
                  <span v-if="stage.rejectedFromStage" class="text-danger-500">· отказ: {{ stage.rejectedFromStage }}</span>
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Drill-down отсеянных -->
      <div
        v-if="dropoffStage"
        class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none"
      >
        <div class="px-5 py-4 border-b border-surface-100 dark:border-surface-800 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UserX class="w-4 h-4 text-danger-500" />
            <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">
              Отсеянные с этапа «{{ dropoffStage.name }}»
              <span class="text-surface-400 font-normal">({{ dropoffTotal }})</span>
            </h2>
          </div>
          <button class="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300" @click="dropoffStage = null">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div v-if="dropoffStatus === 'pending'" class="p-5 space-y-3">
          <div v-for="i in 3" :key="i" class="h-10 bg-surface-100 dark:bg-surface-800/60 rounded-lg animate-pulse" />
        </div>

        <div v-else-if="!dropoffItems.length" class="p-8 text-center text-sm text-surface-400 dark:text-surface-500">
          За выбранный период с этого этапа никто не отсеян
        </div>

        <template v-else>
          <ul class="divide-y divide-surface-100 dark:divide-surface-800">
            <li v-for="item in dropoffItems" :key="`${item.applicationId}-${item.exitedAt}`">
              <NuxtLink
                :to="localePath(`/dashboard/applications/${item.applicationId}`)"
                class="flex items-center gap-3 px-5 py-3 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                    {{ formatPersonName(item.candidateFirstName, item.candidateLastName) }}
                  </p>
                  <p class="text-xs text-surface-500 dark:text-surface-400 truncate">{{ item.jobTitle }}</p>
                </div>
                <div class="text-right shrink-0">
                  <p class="text-xs font-medium text-danger-600 dark:text-danger-400">{{ item.rejectReason }}</p>
                  <p class="text-xs text-surface-400 dark:text-surface-500">
                    {{ item.movedByName ? `${item.movedByName} · ` : '' }}{{ formatDateTime(item.exitedAt) }}
                  </p>
                </div>
              </NuxtLink>
            </li>
          </ul>
          <div v-if="dropoffPages > 1" class="px-5 py-3 border-t border-surface-100 dark:border-surface-800 flex items-center justify-between">
            <button
              class="inline-flex items-center gap-1 text-xs font-medium text-surface-600 dark:text-surface-400 disabled:opacity-40"
              :disabled="dropoffPage <= 1"
              @click="dropoffPage--"
            >
              <ChevronLeft class="w-3.5 h-3.5" /> Назад
            </button>
            <span class="text-xs text-surface-400 tabular-nums">{{ dropoffPage }} / {{ dropoffPages }}</span>
            <button
              class="inline-flex items-center gap-1 text-xs font-medium text-surface-600 dark:text-surface-400 disabled:opacity-40"
              :disabled="dropoffPage >= dropoffPages"
              @click="dropoffPage++"
            >
              Вперёд <ChevronRight class="w-3.5 h-3.5" />
            </button>
          </div>
        </template>
      </div>

      <!-- Sankey переходов -->
      <div v-if="hasTransitions" class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 shadow-xs dark:shadow-none">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Поток переходов (Sankey)</h2>
          <span class="text-xs text-surface-400">толщина потока = число переходов</span>
        </div>
        <ClientOnly>
          <AnalyticsAeChart :option="sankeyOption" :height="340" />
          <template #fallback>
            <div class="h-[340px] animate-pulse rounded-xl bg-surface-100 dark:bg-surface-800" />
          </template>
        </ClientOnly>
      </div>

      <!-- Тренд конверсий -->
      <div v-if="hasTrend" class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 shadow-xs dark:shadow-none">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Динамика конверсий по этапам</h2>
          <span class="text-xs text-surface-400">conversionNext, по неделям</span>
        </div>
        <ClientOnly>
          <AnalyticsAeChart :option="trendChartOption" :height="300" :loading="trendStatus === 'pending'" />
          <template #fallback>
            <div class="h-[300px] animate-pulse rounded-xl bg-surface-100 dark:bg-surface-800" />
          </template>
        </ClientOnly>
      </div>

      <!-- Матрица переходов -->
      <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
        <div class="px-5 py-4 border-b border-surface-100 dark:border-surface-800">
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Переходы между этапами</h2>
          <p class="text-xs text-surface-400 dark:text-surface-500 mt-0.5">Все переходы за период, включая возвраты назад и отказы</p>
        </div>
        <div v-if="!transitions.length" class="p-8 text-center text-sm text-surface-400 dark:text-surface-500">
          Переходов за период не было
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-surface-100 dark:border-surface-800 text-xs text-surface-400 dark:text-surface-500">
                <th class="text-left font-medium px-5 py-2.5">Откуда</th>
                <th class="text-left font-medium px-5 py-2.5">Куда</th>
                <th class="text-right font-medium px-5 py-2.5">Переходов</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-50 dark:divide-surface-800/60">
              <tr v-for="tr in transitions" :key="`${tr.fromId}-${tr.toId}`">
                <td class="px-5 py-2.5 text-surface-700 dark:text-surface-300">{{ tr.fromName }}</td>
                <td class="px-5 py-2.5 text-surface-700 dark:text-surface-300">{{ tr.toName }}</td>
                <td class="px-5 py-2.5 text-right tabular-nums font-medium text-surface-900 dark:text-surface-100">{{ tr.count }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
