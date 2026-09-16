<script setup lang="ts">
import { BarChart3 } from 'lucide-vue-next'
import { baseCartesianOption, formatTrendLabel, CHART_SEMANTIC } from '~/utils/analytics/chart-theme'

interface VacancyStats {
  totalResponses: number
  inConsider: number
  inInterview: number
  inOffer: number
  hired: number
  discarded: number
  avgTimeToResponse: number | null
  avgTimeToInterview: number | null
  avgTimeToOffer: number | null
  avgTimeToHire: number | null
  conversionRate: number
}

interface StatsTrendPoint {
  snapshotDate: string
  totalResponses: number
  hired: number
  conversionRate: number
  avgTimeToHire: number | null
}

const props = defineProps<{
  current: VacancyStats | null
  trend: StatsTrendPoint[] | null
}>()

const { t } = useI18n()
const { isDark } = useColorMode()

const c = computed(() => props.current)

const metrics = computed(() => [
  { key: 'responses', value: c.value?.totalResponses ?? 0, label: t('dashboard.jobs.stats.metrics.responses') },
  { key: 'interviews', value: c.value?.inInterview ?? 0, label: t('dashboard.jobs.stats.metrics.interviews') },
  { key: 'conversion', value: `${c.value?.conversionRate ?? 0}%`, label: t('dashboard.jobs.stats.metrics.conversion') },
  { key: 'hires', value: c.value?.hired ?? 0, label: t('dashboard.jobs.stats.metrics.hires') },
])

const breakdown = computed(() => {
  const cur = c.value
  const items = [
    { key: 'consider', count: cur?.inConsider ?? 0, label: t('dashboard.jobs.stats.breakdown.consider'), color: CHART_SEMANTIC.warning },
    { key: 'interview', count: cur?.inInterview ?? 0, label: t('dashboard.jobs.stats.breakdown.interview'), color: CHART_SEMANTIC.neutral },
    { key: 'offer', count: cur?.inOffer ?? 0, label: t('dashboard.jobs.stats.breakdown.offer'), color: '#3b82f6' },
    { key: 'hired', count: cur?.hired ?? 0, label: t('dashboard.jobs.stats.breakdown.hired'), color: CHART_SEMANTIC.positive },
    { key: 'discarded', count: cur?.discarded ?? 0, label: t('dashboard.jobs.stats.breakdown.discarded'), color: CHART_SEMANTIC.negative },
  ]
  const total = items.reduce((sum, i) => sum + i.count, 0)
  return items.map(i => ({
    ...i,
    pct: total > 0 ? Math.round((i.count / total) * 100) : 0,
  }))
})

const trendPoints = computed(() =>
  [...(props.trend ?? [])].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate)),
)
const hasTrend = computed(() => trendPoints.value.length > 1)

const trendOption = computed(() => {
  if (!hasTrend.value) return {}
  const base = baseCartesianOption(isDark.value)
  const labels = trendPoints.value.map(p => formatTrendLabel(p.snapshotDate, 'day'))
  return {
    ...base,
    tooltip: { ...base.tooltip, trigger: 'axis' as const },
    xAxis: { type: 'category' as const, data: labels, axisTick: { show: false } },
    yAxis: { type: 'value' as const, minInterval: 1 },
    series: [
      {
        name: t('dashboard.jobs.stats.trend.responses'),
        type: 'line',
        smooth: true,
        connectNulls: true,
        data: trendPoints.value.map(p => p.totalResponses),
        itemStyle: { color: CHART_SEMANTIC.neutral },
        lineStyle: { color: CHART_SEMANTIC.neutral, width: 2 },
        areaStyle: { color: CHART_SEMANTIC.neutral, opacity: 0.08 },
      },
      {
        name: t('dashboard.jobs.stats.trend.hires'),
        type: 'line',
        smooth: true,
        connectNulls: true,
        data: trendPoints.value.map(p => p.hired),
        itemStyle: { color: CHART_SEMANTIC.positive },
        lineStyle: { color: CHART_SEMANTIC.positive, width: 2 },
        areaStyle: { color: CHART_SEMANTIC.positive, opacity: 0.08 },
      },
    ],
  }
})
</script>

<template>
  <div class="space-y-6">
    <!-- Metric cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <UiCard v-for="m in metrics" :key="m.key" padding="md">
        <div class="flex flex-col">
          <span class="text-3xl font-black tabular-nums leading-none text-surface-900 dark:text-surface-50">
            {{ m.value }}
          </span>
          <span class="mt-2 text-xs font-medium text-surface-500 dark:text-surface-400">{{ m.label }}</span>
        </div>
      </UiCard>
    </div>

    <!-- Trend chart -->
    <UiCard padding="none">
      <template #header>
        <div class="flex items-center gap-2.5">
          <div class="flex items-center justify-center size-7 rounded-lg bg-surface-100 dark:bg-surface-800">
            <BarChart3 class="size-3.5 text-surface-500 dark:text-surface-400" />
          </div>
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">
            {{ t('dashboard.jobs.stats.trend.title') }}
          </h2>
        </div>
      </template>
      <div class="p-5">
        <AeChart v-if="hasTrend" :option="trendOption" height="320" />
        <p v-else class="py-16 text-center text-sm text-surface-400 dark:text-surface-500">
          {{ t('dashboard.jobs.stats.noTrend') }}
        </p>
      </div>
    </UiCard>

    <!-- Status breakdown -->
    <UiCard padding="none">
      <template #header>
        <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">
          {{ t('dashboard.jobs.stats.breakdown.title') }}
        </h2>
      </template>
      <div class="p-5 space-y-3">
        <div v-for="row in breakdown" :key="row.key" class="flex items-center gap-3">
          <span class="w-28 shrink-0 text-xs font-medium text-surface-600 dark:text-surface-300">{{ row.label }}</span>
          <div class="flex-1 h-2 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500" :style="{ width: `${row.pct}%`, backgroundColor: row.color }" />
          </div>
          <span class="w-24 shrink-0 text-right text-xs tabular-nums text-surface-700 dark:text-surface-200">
            {{ row.count }} ({{ row.pct }}%)
          </span>
        </div>
      </div>
    </UiCard>
  </div>
</template>
