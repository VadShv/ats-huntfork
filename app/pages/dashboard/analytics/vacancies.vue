<script setup lang="ts">
import {
  ChartNoAxesCombined, AlertCircle, RefreshCw,
  Briefcase, Clock, Timer, Users, BadgeCheck, UserX, AlertTriangle, Download,
} from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Аналитика подбора — Вакансии',
  description: 'Сроки закрытия, возраст, застрявшие кандидаты по каждой вакансии',
})

const localePath = useLocalePath()

import { useAnalyticsFilters } from '~/composables/useAnalyticsFilters'
const { query } = useAnalyticsFilters()

const sort = ref<'daysOpen' | 'timeToFill' | 'hires' | 'stuck' | 'createdAt'>('daysOpen')

const { data: vacancies, status: vacStatus, error: vacError, refresh: refreshVac } = useFetch('/api/analytics/jobs', {
  key: 'analytics-vacancies',
  headers: useRequestHeaders(['cookie']),
  query: computed(() => ({ ...query.value, sort: sort.value })),
})

const isLoading = computed(() => vacStatus.value === 'pending' && !vacancies.value)
const items = computed(() => (vacancies.value as any)?.items ?? [])

const refreshedAtLabel = computed(() => {
  const iso = (vacancies.value as any)?.refreshedAt
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
})

const statusLabels: Record<string, string> = {
  draft: 'Черновик', open: 'Открыта', closed: 'Закрыта', archived: 'Архив',
}
const statusColors: Record<string, string> = {
  draft: 'text-surface-400', open: 'text-success-600 dark:text-success-400',
  closed: 'text-surface-500', archived: 'text-surface-400',
}

function fmtDays(d: number | null) {
  if (d == null) return '—'
  if (d === 0) return 'сегодня'
  return `${d} дн`
}

// Экспорт
function exportUrl(format: 'csv' | 'xlsx') {
  const params = new URLSearchParams({ ...query.value, report: 'jobs', format })
  return `/api/analytics/export?${params.toString()}`
}

// Drawer с воронкой вакансии
const selectedJobId = ref<string | null>(null)

// Heatmap aging
import { themeColors, CHART_PALETTE } from '~/utils/analytics/chart-theme'
const { isDark } = useColorMode()
const aging = computed<any>(() => (vacancies.value as any)?.aging ?? null)
const hasAging = computed(() => {
  const m = aging.value?.matrix
  return m && m.some((row: number[]) => row.some((v: number) => v > 0))
})
const agingChartOption = computed(() => {
  const a = aging.value
  if (!a) return {}
  const c = themeColors(isDark.value)
  const data: [number, number, number][] = []
  let maxV = 1
  for (let y = 0; y < a.matrix.length; y++) {
    for (let x = 0; x < a.matrix[y].length; x++) {
      const v = a.matrix[y][x]
      data.push([x, y, v])
      if (v > maxV) maxV = v
    }
  }
  return {
    tooltip: { position: 'top', backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, textStyle: { color: c.text, fontSize: 12 },
      formatter: (p: any) => `${a.rowLabels[p.data[1]]}<br/>${a.bucketLabels[p.data[0]]} дн: <b>${p.data[2]}</b>` },
    grid: { left: 150, right: 20, top: 10, bottom: 40, containLabel: false },
    xAxis: { type: 'category', data: a.bucketLabels, name: 'дней', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: c.textMuted, fontSize: 10 }, axisLabel: { color: c.textMuted }, splitArea: { show: true } },
    yAxis: { type: 'category', data: a.rowLabels, axisLabel: { color: c.textMuted, fontSize: 10, width: 140, overflow: 'truncate' }, splitArea: { show: true } },
    visualMap: { min: 0, max: maxV, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, show: false, inRange: { color: isDark.value ? ['#1e293b', '#6366f1'] : ['#eef2ff', '#4f46e5'] } },
    series: [{ type: 'heatmap', data, label: { show: true, color: c.text, fontSize: 11 }, itemStyle: { borderColor: c.splitLine, borderWidth: 1 } }],
  }
})
</script>

<template>
  <div class="space-y-6">
    <!-- Заголовок + навигация -->
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

    <!-- Фильтры -->
    <AnalyticsFilterBar show-job show-source>
      <template #extra>
        <select v-model="sort" class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs text-surface-700 dark:text-surface-300">
          <option value="daysOpen">Сортировка: Дней открыта</option>
          <option value="timeToFill">Сортировка: Срок закрытия</option>
          <option value="hires">Сортировка: Наймы</option>
          <option value="stuck">Сортировка: Застрявшие</option>
          <option value="createdAt">Сортировка: Создана</option>
        </select>
      </template>
      <template #actions>
        <a :href="exportUrl('xlsx')" class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800">
          <Download class="w-3.5 h-3.5" /> Excel
        </a>
        <a :href="exportUrl('csv')" class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800">
          CSV
        </a>
      </template>
    </AnalyticsFilterBar>

    <!-- Ошибка -->
    <div v-if="vacError" class="rounded-2xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/60 p-5 text-sm text-danger-700 dark:text-danger-400 flex items-center gap-3">
      <AlertCircle class="w-5 h-5 shrink-0" />
      Не удалось загрузить данные. <button class="underline" @click="refreshVac()">Повторить</button>
    </div>

    <!-- Скелетон -->
    <div v-else-if="isLoading" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 space-y-4 animate-pulse">
      <div v-for="i in 6" :key="i" class="h-10 bg-surface-100 dark:bg-surface-800/60 rounded-lg" />
    </div>

    <!-- Пусто -->
    <div v-else-if="!items.length" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-10 text-center text-sm text-surface-400 dark:text-surface-500">
      Нет вакансий в выбранном скоупе
    </div>

    <!-- Heatmap aging -->
    <div v-if="!isLoading && hasAging" class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 shadow-xs dark:shadow-none">
      <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50 mb-3">Распределение по срокам</h2>
      <ClientOnly>
        <AnalyticsAeChart :option="agingChartOption" :height="160" />
        <template #fallback><div class="h-[160px] animate-pulse rounded-xl bg-surface-100 dark:bg-surface-800" /></template>
      </ClientOnly>
    </div>

    <!-- Таблица вакансий -->
    <div v-if="!isLoading && items.length" class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-100 dark:border-surface-800 text-xs text-surface-400 dark:text-surface-500">
              <th class="text-left font-medium px-5 py-3">Вакансия</th>
              <th class="text-left font-medium px-3 py-3">Статус</th>
              <th class="text-right font-medium px-3 py-3">Дней открыта</th>
              <th class="text-right font-medium px-3 py-3">Срок закрытия</th>
              <th class="text-right font-medium px-3 py-3">Активные</th>
              <th class="text-right font-medium px-3 py-3">Наймы</th>
              <th class="text-right font-medium px-3 py-3">Отказы</th>
              <th class="text-right font-medium px-3 py-3">Застрявшие</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-50 dark:divide-surface-800/60">
            <tr v-for="v in items" :key="v.id" class="hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors cursor-pointer" @click="selectedJobId = v.id">
              <td class="px-5 py-3">
                <span class="font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400">
                  {{ v.title }}
                </span>
                <div class="text-xs text-surface-400 mt-0.5">
                  <span v-if="v.departmentName">{{ v.departmentName }}</span>
                  <span v-if="v.departmentName && v.companyName"> · </span>
                  <span v-if="v.companyName">{{ v.companyName }}</span>
                  <span v-if="v.reopenCount > 0" class="text-warning-500"> · reopen: {{ v.reopenCount }}</span>
                </div>
              </td>
              <td class="px-3 py-3">
                <span :class="statusColors[v.status]">{{ statusLabels[v.status] ?? v.status }}</span>
              </td>
              <td class="px-3 py-3 text-right tabular-nums" :class="v.daysOpen != null && v.daysOpen > 30 ? 'text-warning-600 dark:text-warning-400 font-medium' : 'text-surface-600 dark:text-surface-400'">
                {{ fmtDays(v.daysOpen) }}
              </td>
              <td class="px-3 py-3 text-right tabular-nums text-surface-600 dark:text-surface-400">
                {{ fmtDays(v.timeToFill) }}
              </td>
              <td class="px-3 py-3 text-right tabular-nums text-surface-600 dark:text-surface-400">{{ v.activeCandidates }}</td>
              <td class="px-3 py-3 text-right tabular-nums font-medium text-success-600 dark:text-success-400">
                {{ v.hires }}<span v-if="v.headcount > 1" class="text-surface-400 font-normal"> ({{ v.totalHires }}/{{ v.headcount }})</span>
                <span v-if="v.fullyFilled" class="ml-1 text-xs">✓</span>
              </td>
              <td class="px-3 py-3 text-right tabular-nums text-surface-600 dark:text-surface-400">{{ v.rejections }}</td>
              <td class="px-3 py-3 text-right tabular-nums" :class="v.stuck > 0 ? 'text-danger-600 dark:text-danger-400 font-medium' : 'text-surface-400'">
                {{ v.stuck > 0 ? v.stuck : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Drawer с воронкой вакансии -->
    <AnalyticsVacancyDrawer :job-id="selectedJobId" :query="query" @close="selectedJobId = null" />
  </div>
</template>
