<script setup lang="ts">
import { ChartNoAxesCombined, AlertCircle, RefreshCw, Link2, ExternalLink, Globe } from 'lucide-vue-next'

definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })
useSeoMeta({ title: 'Аналитика подбора — Источники', description: 'Конверсия по источникам привлечения, каналы, CTR, атрибуция' })

const localePath = useLocalePath()
import { useAnalyticsFilters } from '~/composables/useAnalyticsFilters'
const { query } = useAnalyticsFilters()

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

// Последние атрибутированные отклики (пагинация)
const { formatPersonName, formatDateTime } = useOrgSettings()
const attrPage = ref(1)
watch(query, () => { attrPage.value = 1 })
const { data: attributed } = useFetch('/api/analytics/sources/attributed', {
  key: 'analytics-sources-attributed',
  headers: useRequestHeaders(['cookie']),
  query: computed(() => ({ ...query.value, page: String(attrPage.value), limit: '15' })),
})
const attrItems = computed<any[]>(() => (attributed.value as any)?.items ?? [])
const attrTotal = computed(() => (attributed.value as any)?.total ?? 0)
const attrPages = computed(() => Math.max(1, Math.ceil(attrTotal.value / 15)))
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

    <AnalyticsFilterBar show-job>
      <template #actions>
        <NuxtLink :to="localePath('/dashboard/source-tracking')" class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800">
          <Link2 class="w-3.5 h-3.5" /> Управление ссылками →
        </NuxtLink>
      </template>
    </AnalyticsFilterBar>

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

      <!-- Последние атрибутированные отклики -->
      <div v-if="attrItems.length" class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
        <div class="px-5 py-4 border-b border-surface-100 dark:border-surface-800 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Последние атрибутированные <span class="text-surface-400 font-normal">({{ attrTotal }})</span></h2>
        </div>
        <ul class="divide-y divide-surface-50 dark:divide-surface-800/60">
          <li v-for="a in attrItems" :key="a.applicationId">
            <NuxtLink :to="localePath(`/dashboard/applications/${a.applicationId}`)" class="flex items-center gap-3 px-5 py-3 hover:bg-surface-50 dark:hover:bg-surface-800/50">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{{ formatPersonName(a.candidateFirstName, a.candidateLastName) }}</p>
                <p class="text-xs text-surface-500 dark:text-surface-400 truncate">
                  {{ channelLabel(a.channel) }}<span v-if="a.source"> · {{ a.source }}</span><span v-if="a.jobTitle"> · {{ a.jobTitle }}</span>
                </p>
              </div>
              <span v-if="a.changedAt" class="text-xs text-surface-400 shrink-0">{{ formatDateTime(a.changedAt) }}</span>
            </NuxtLink>
          </li>
        </ul>
        <div v-if="attrPages > 1" class="px-5 py-3 border-t border-surface-100 dark:border-surface-800 flex items-center justify-between">
          <button class="inline-flex items-center gap-1 text-xs font-medium text-surface-600 dark:text-surface-400 disabled:opacity-40" :disabled="attrPage <= 1" @click="attrPage--">Назад</button>
          <span class="text-xs text-surface-400 tabular-nums">{{ attrPage }} / {{ attrPages }}</span>
          <button class="inline-flex items-center gap-1 text-xs font-medium text-surface-600 dark:text-surface-400 disabled:opacity-40" :disabled="attrPage >= attrPages" @click="attrPage++">Вперёд</button>
        </div>
      </div>
    </template>

    <AnalyticsDrillDownModal v-if="drill" :url="drill.url" :query="drill.query" :title="drill.title" @close="drill = null" />
  </div>
</template>
