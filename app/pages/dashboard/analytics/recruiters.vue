<script setup lang="ts">
import { ChartNoAxesCombined, AlertCircle, RefreshCw, Filter as FilterIcon, Users, BadgeCheck, UserX, Briefcase, Activity, Timer } from 'lucide-vue-next'

definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })
useSeoMeta({ title: 'Аналитика подбора — Рекрутеры', description: 'Продуктивность рекрутеров: наймы, нагрузка, время закрытия' })

const localePath = useLocalePath()
import { useAnalyticsFilters } from '~/composables/useAnalyticsFilters'
const { periodPreset, source, query } = useAnalyticsFilters()

const periodOptions = [
  { value: '7d' as const, label: '7 дней' },
  { value: '30d' as const, label: '30 дней' },
  { value: '90d' as const, label: '90 дней' },
]
const sourceOptions = [
  { value: '', label: 'Все источники' },
  { value: 'hh', label: 'hh.ru' },
  { value: 'manual', label: 'Вручную' },
]

const { data: recruiters, status: rStatus, error: rError, refresh: refreshR } = useFetch('/api/analytics/recruiters', {
  key: 'analytics-recruiters',
  headers: useRequestHeaders(['cookie']),
  query,
})
const isLoading = computed(() => rStatus.value === 'pending' && !recruiters.value)
const items = computed(() => (recruiters.value as any)?.items ?? [])
const refreshedAtLabel = computed(() => {
  const iso = (recruiters.value as any)?.refreshedAt
  return iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null
})

// График сравнения наймов
import { baseCartesianOption, CHART_SEMANTIC } from '~/utils/analytics/chart-theme'
const { isDark } = useColorMode()
// Drawer активности рекрутёра
const selectedRecruiter = ref<{ userId: string, name: string } | null>(null)

// Drill-down
const drill = ref<{ url: string, query: Record<string, string>, title: string } | null>(null)
function openDrill(userId: string, metric: 'hires' | 'moves' | 'rejections', name: string) {
  const titles = { hires: 'Наймы', moves: 'Ходы', rejections: 'Отказы' }
  drill.value = {
    url: `/api/analytics/recruiters/${userId}/candidates`,
    query: { ...query.value, metric },
    title: `${titles[metric]} — ${name}`,
  }
}

const hireChartOption = computed(() => {
  if (!items.value.length) return {}
  const base = baseCartesianOption(isDark.value)
  const sorted = [...items.value].sort((a, b) => b.hires - a.hires).slice(0, 10)
  return {
    ...base,
    tooltip: { ...base.tooltip, trigger: 'item' },
    grid: { ...base.grid, left: 120 },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', data: sorted.map(r => r.name), inverse: true, axisTick: { show: false } },
    series: [
      { name: 'Наймы', type: 'bar', data: sorted.map(r => r.hires), itemStyle: { color: CHART_SEMANTIC.positive, borderRadius: [0, 3, 3, 0] } },
      { name: 'Отказы', type: 'bar', data: sorted.map(r => r.rejections), itemStyle: { color: CHART_SEMANTIC.negative, borderRadius: [0, 3, 3, 0] } },
    ],
  }
})
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
        <select v-model="source" class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs text-surface-700 dark:text-surface-300">
          <option v-for="opt in sourceOptions" :key="opt.value" :value="opt.value || undefined">{{ opt.label }}</option>
        </select>
        <div class="ml-auto"><AnalyticsPresetSelector /></div>
      </div>
    </div>

    <div v-if="rError" class="rounded-2xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/60 p-5 text-sm text-danger-700 dark:text-danger-400 flex items-center gap-3">
      <AlertCircle class="w-5 h-5 shrink-0" />
      <span v-if="(rError as any)?.statusCode === 403">Доступ только для администраторов организации</span>
      <span v-else>Не удалось загрузить. <button class="underline" @click="refreshR()">Повторить</button></span>
    </div>

    <div v-else-if="isLoading" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 space-y-4 animate-pulse">
      <div v-for="i in 5" :key="i" class="h-10 bg-surface-100 dark:bg-surface-800/60 rounded-lg" />
    </div>

    <div v-else-if="!items.length" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-10 text-center text-sm text-surface-400 dark:text-surface-500">
      Нет активных рекрутеров в организации
    </div>

    <template v-else>
      <!-- График сравнения -->
      <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 shadow-xs dark:shadow-none">
        <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50 mb-3">Топ-10 по наймам</h2>
        <ClientOnly>
          <AnalyticsAeChart :option="hireChartOption" :height="300" />
          <template #fallback><div class="h-[300px] animate-pulse rounded-xl bg-surface-100 dark:bg-surface-800" /></template>
        </ClientOnly>
      </div>

      <!-- Таблица -->
      <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-surface-100 dark:border-surface-800 text-xs text-surface-400 dark:text-surface-500">
                <th class="text-left font-medium px-5 py-3">Рекрутер</th>
                <th class="text-right font-medium px-3 py-3">Вакансий в работе</th>
                <th class="text-right font-medium px-3 py-3">Активные кандидаты</th>
                <th class="text-right font-medium px-3 py-3">Наймы</th>
                <th class="text-right font-medium px-3 py-3">Отказы</th>
                <th class="text-right font-medium px-3 py-3">Ходов</th>
                <th class="text-right font-medium px-3 py-3">Интервью (запл/пров)</th>
                <th class="text-right font-medium px-3 py-3">No-show</th>
                <th class="text-right font-medium px-3 py-3">Ср. срок закрытия</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-50 dark:divide-surface-800/60">
              <tr v-for="r in items" :key="r.userId" class="hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-pointer" @click="selectedRecruiter = { userId: r.userId, name: r.name }">
                <td class="px-5 py-3 font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400">{{ r.name }}</td>
                <td class="px-3 py-3 text-right tabular-nums text-surface-600 dark:text-surface-400">{{ r.openVacancies }}</td>
                <td class="px-3 py-3 text-right tabular-nums text-surface-600 dark:text-surface-400">{{ r.activeCandidates }}</td>
                <td class="px-3 py-3 text-right tabular-nums font-medium text-success-600 dark:text-success-400">
                  <button class="hover:underline" @click.stop="openDrill(r.userId, 'hires', r.name)">{{ r.hires }}</button>
                </td>
                <td class="px-3 py-3 text-right tabular-nums text-surface-600 dark:text-surface-400">
                  <button class="hover:underline" @click.stop="openDrill(r.userId, 'rejections', r.name)">{{ r.rejections }}</button>
                </td>
                <td class="px-3 py-3 text-right tabular-nums text-surface-600 dark:text-surface-400">
                  <button class="hover:underline" @click.stop="openDrill(r.userId, 'moves', r.name)">{{ r.moves }}</button>
                </td>
                <td class="px-3 py-3 text-right tabular-nums text-surface-600 dark:text-surface-400">
                  {{ r.interviewsScheduled }} / <span class="text-success-600 dark:text-success-400">{{ r.interviewsCompleted }}</span>
                </td>
                <td class="px-3 py-3 text-right tabular-nums" :class="r.interviewsNoShow > 0 ? 'text-danger-600 dark:text-danger-400 font-medium' : 'text-surface-400'">
                  {{ r.interviewsNoShow > 0 ? r.interviewsNoShow : '—' }}
                </td>
                <td class="px-3 py-3 text-right tabular-nums text-surface-600 dark:text-surface-400">{{ r.avgTimeToFillDays != null ? `${r.avgTimeToFillDays} дн` : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <AnalyticsDrillDownModal v-if="drill" :url="drill.url" :query="drill.query" :title="drill.title" @close="drill = null" />
    <AnalyticsRecruiterDrawer
      v-if="selectedRecruiter"
      :user-id="selectedRecruiter.userId"
      :name="selectedRecruiter.name"
      :query="query"
      @close="selectedRecruiter = null"
    />
  </div>
</template>
