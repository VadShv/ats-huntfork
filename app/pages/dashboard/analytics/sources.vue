<script setup lang="ts">
import { ChartNoAxesCombined, AlertCircle, RefreshCw, Filter as FilterIcon, Link2, ExternalLink, Globe } from 'lucide-vue-next'

definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })
useSeoMeta({ title: 'Аналитика подбора — Источники', description: 'Конверсия по источникам привлечения, каналы, CTR, атрибуция' })

const localePath = useLocalePath()
import { useAnalyticsFilters } from '~/composables/useAnalyticsFilters'
const { periodPreset, jobId, query } = useAnalyticsFilters()

const periodOptions = [
  { value: '7d' as const, label: '7 дней' },
  { value: '30d' as const, label: '30 дней' },
  { value: '90d' as const, label: '90 дней' },
]

const { data: jobsData } = useFetch('/api/jobs', { key: 'analytics-jobs', headers: useRequestHeaders(['cookie']), query: { limit: 100 } })
const jobs = computed(() => (jobsData.value as any)?.data ?? [])

const { data: sources, status: sStatus, error: sError, refresh: refreshS } = useFetch('/api/analytics/sources/overview', {
  key: 'analytics-sources-overview',
  headers: useRequestHeaders(['cookie']),
  query,
})
const isLoading = computed(() => sStatus.value === 'pending' && !sources.value)
const d = computed<any>(() => sources.value ?? {})
const channelBreakdown = computed<any[]>(() => d.value.channelBreakdown ?? [])
const topLinks = computed<any[]>(() => d.value.topLinks ?? [])
const referrers = computed<any[]>(() => d.value.topReferrerDomains ?? [])
const funnelStages = computed<any[]>(() => d.value.funnelStages ?? [])
const funnel = computed<Record<string, Record<string, number>>>(() => d.value.funnel ?? {})
const dailyTrend = computed<any[]>(() => d.value.dailyTrend ?? [])
const summary = computed<any>(() => d.value.summary ?? { totalTracked: 0, totalUntracked: 0, attributionRate: 0 })
const hasData = computed(() => channelBreakdown.value.length > 0 || topLinks.value.length > 0)
const refreshedAtLabel = computed(() => {
  const iso = d.value.refreshedAt
  return iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null
})

function channelLabel(c: string) { return c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ') }

import { baseCartesianOption, CHART_SEMANTIC, CHART_PALETTE } from '~/utils/analytics/chart-theme'
const { isDark } = useColorMode()

// Bar: отклики по каналам
const channelChartOption = computed(() => {
  if (!channelBreakdown.value.length) return {}
  const base = baseCartesianOption(isDark.value)
  return {
    ...base, tooltip: { ...base.tooltip, trigger: 'item' },
    grid: { ...base.grid, left: 110 },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', data: channelBreakdown.value.map(c => channelLabel(c.channel)), inverse: true, axisTick: { show: false } },
    series: [{ type: 'bar', data: channelBreakdown.value.map(c => c.count), itemStyle: { color: CHART_PALETTE[4], borderRadius: [0, 3, 3, 0] } }],
  }
})

// Line: daily trend (сумма по всем каналам)
const trendChartOption = computed(() => {
  if (!dailyTrend.value.length) return {}
  const base = baseCartesianOption(isDark.value)
  const byDate = new Map<string, number>()
  for (const r of dailyTrend.value) byDate.set(String(r.date), (byDate.get(String(r.date)) ?? 0) + r.count)
  const dates = [...byDate.keys()].sort()
  return {
    ...base,
    xAxis: { type: 'category', data: dates.map(x => new Date(x).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })), axisTick: { show: false } },
    yAxis: { type: 'value', minInterval: 1 },
    series: [{ type: 'line', smooth: true, data: dates.map(x => byDate.get(x) ?? 0), itemStyle: { color: CHART_SEMANTIC.neutral }, lineStyle: { color: CHART_SEMANTIC.neutral, width: 2 }, areaStyle: { color: CHART_SEMANTIC.neutral, opacity: 0.08 } }],
  }
})

// Drill-down по каналу
const drill = ref<{ url: string, query: Record<string, string>, title: string } | null>(null)
function openDrill(channel: string) {
  drill.value = { url: '/api/analytics/sources/candidates', query: { ...query.value, source: channel }, title: `Отклики — ${channelLabel(channel)}` }
}
</script>

<template>
  <div class="space-y-6">
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

    <div class="sticky top-0 z-10 -mx-1 px-1 py-2 bg-surface-50/95 dark:bg-surface-950/95 backdrop-blur border-b border-surface-200/60 dark:border-surface-800/60">
      <div class="flex flex-wrap items-center gap-2">
        <FilterIcon class="w-4 h-4 text-surface-400 shrink-0" />
        <div class="flex rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
          <button v-for="opt in periodOptions" :key="opt.value"
            class="px-3 py-1.5 text-xs font-medium transition-colors"
            :class="periodPreset === opt.value ? 'bg-primary-600 text-white' : 'bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'"
            @click="periodPreset = opt.value">{{ opt.label }}</button>
        </div>
        <select v-model="jobId" class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs text-surface-700 dark:text-surface-300 max-w-56">
          <option :value="undefined">Все вакансии</option>
          <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }}</option>
        </select>
        <div class="ml-auto flex items-center gap-2">
          <NuxtLink :to="localePath('/dashboard/source-tracking')" class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800">
            <Link2 class="w-3.5 h-3.5" /> Управление ссылками →
          </NuxtLink>
          <AnalyticsPresetSelector />
        </div>
      </div>
    </div>

    <div v-if="sError" class="rounded-2xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/60 p-5 text-sm text-danger-700 dark:text-danger-400 flex items-center gap-3">
      <AlertCircle class="w-5 h-5 shrink-0" />
      Не удалось загрузить. <button class="underline" @click="refreshS()">Повторить</button>
    </div>

    <div v-else-if="isLoading" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div v-for="i in 2" :key="i" class="h-64 animate-pulse rounded-2xl bg-surface-100 dark:bg-surface-800" />
    </div>

    <div v-else-if="!hasData" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-10 text-center text-sm text-surface-400 dark:text-surface-500">
      Нет данных по источникам за период
    </div>

    <template v-else>
      <!-- Summary -->
      <div class="grid grid-cols-3 gap-4">
        <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
          <div class="text-xs text-surface-500 mb-1">Атрибуция</div>
          <div class="text-2xl font-semibold text-surface-900 dark:text-surface-50 tabular-nums">{{ summary.attributionRate }}%</div>
        </div>
        <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
          <div class="text-xs text-surface-500 mb-1">С источником</div>
          <div class="text-2xl font-semibold text-success-600 dark:text-success-400 tabular-nums">{{ summary.totalTracked }}</div>
        </div>
        <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
          <div class="text-xs text-surface-500 mb-1">Без источника</div>
          <div class="text-2xl font-semibold text-surface-400 tabular-nums">{{ summary.totalUntracked }}</div>
        </div>
      </div>

      <!-- Каналы + тренд -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50 mb-3">Отклики по каналам</h2>
          <ClientOnly>
            <AnalyticsAeChart :option="channelChartOption" :height="260" />
            <template #fallback><div class="h-[260px] animate-pulse rounded-xl bg-surface-100 dark:bg-surface-800" /></template>
          </ClientOnly>
        </div>
        <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50 mb-3">Динамика по дням</h2>
          <ClientOnly>
            <AnalyticsAeChart :option="trendChartOption" :height="260" />
            <template #fallback><div class="h-[260px] animate-pulse rounded-xl bg-surface-100 dark:bg-surface-800" /></template>
          </ClientOnly>
        </div>
      </div>

      <!-- Top-links CTR -->
      <div v-if="topLinks.length" class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
        <div class="px-5 py-4 border-b border-surface-100 dark:border-surface-800"><h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Топ трекинг-ссылок</h2></div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="border-b border-surface-100 dark:border-surface-800 text-xs text-surface-400">
              <th class="text-left font-medium px-5 py-3">Ссылка</th><th class="text-left font-medium px-3 py-3">Канал</th>
              <th class="text-right font-medium px-3 py-3">Клики</th><th class="text-right font-medium px-3 py-3">Отклики</th><th class="text-right font-medium px-3 py-3">CTR</th>
            </tr></thead>
            <tbody class="divide-y divide-surface-50 dark:divide-surface-800/60">
              <tr v-for="l in topLinks" :key="l.id" class="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                <td class="px-5 py-3 font-medium text-surface-900 dark:text-surface-100">{{ l.name }}<span v-if="l.jobTitle" class="text-xs text-surface-400"> · {{ l.jobTitle }}</span></td>
                <td class="px-3 py-3 text-surface-600 dark:text-surface-400">{{ channelLabel(l.channel) }}</td>
                <td class="px-3 py-3 text-right tabular-nums text-surface-600 dark:text-surface-400">{{ l.clickCount }}</td>
                <td class="px-3 py-3 text-right tabular-nums font-medium text-surface-900 dark:text-surface-100">{{ l.applicationCount }}</td>
                <td class="px-3 py-3 text-right tabular-nums text-surface-600 dark:text-surface-400">{{ l.ctr != null ? `${Math.round(l.ctr * 100)}%` : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Воронка источник → этапы -->
      <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
        <div class="px-5 py-4 border-b border-surface-100 dark:border-surface-800"><h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Источники → этапы воронки</h2></div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="border-b border-surface-100 dark:border-surface-800 text-xs text-surface-400">
              <th class="text-left font-medium px-5 py-3 sticky left-0 bg-white dark:bg-surface-900">Канал</th>
              <th class="text-right font-medium px-3 py-3">Откликов</th>
              <th v-for="st in funnelStages" :key="st.id" class="text-right font-medium px-3 py-3 whitespace-nowrap">{{ st.name }}</th>
            </tr></thead>
            <tbody class="divide-y divide-surface-50 dark:divide-surface-800/60">
              <tr v-for="c in channelBreakdown" :key="c.channel" class="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                <td class="px-5 py-3 font-medium text-surface-900 dark:text-surface-100 sticky left-0 bg-white dark:bg-surface-900">{{ channelLabel(c.channel) }}</td>
                <td class="px-3 py-3 text-right tabular-nums text-surface-600 dark:text-surface-400">
                  <button class="hover:underline" @click="openDrill(c.channel)">{{ c.count }}</button>
                </td>
                <td v-for="st in funnelStages" :key="st.id" class="px-3 py-3 text-right tabular-nums text-surface-400">{{ funnel[c.channel]?.[st.id] ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Referrer домены -->
      <div v-if="referrers.length" class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
        <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50 mb-3 flex items-center gap-2"><Globe class="w-4 h-4 text-surface-400" /> Referrer-домены</h2>
        <div class="flex flex-wrap gap-2">
          <span v-for="r in referrers" :key="r.domain" class="inline-flex items-center gap-1.5 rounded-lg bg-surface-100 dark:bg-surface-800 px-3 py-1.5 text-xs text-surface-700 dark:text-surface-300">
            {{ r.domain }} <span class="tabular-nums font-medium text-surface-500">{{ r.count }}</span>
          </span>
        </div>
      </div>
    </template>

    <AnalyticsDrillDownModal v-if="drill" :url="drill.url" :query="drill.query" :title="drill.title" @close="drill = null" />
  </div>
</template>
