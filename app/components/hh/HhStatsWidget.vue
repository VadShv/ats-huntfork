<script setup lang="ts">
import { TrendingUp, TrendingDown, Minus, ArrowRight, BarChart3 } from 'lucide-vue-next'

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

const { t } = useI18n()
const localePath = useLocalePath()
const { connected } = useHhStatus()

const { data: stats, status: statsStatus } = useFetch<{ current: VacancyStats, trend: StatsTrendPoint[] }>(
  '/api/hh/stats/org',
  {
    key: 'hh-stats-summary',
    headers: useRequestHeaders(['cookie']),
  },
)

const current = computed(() => stats.value?.current ?? null)
const isLoading = computed(() => statsStatus.value === 'pending')

const sortedTrend = computed(() =>
  [...(stats.value?.trend ?? [])].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate)),
)

const responsesDelta = computed(() => {
  const tr = sortedTrend.value
  if (tr.length < 2) return null
  const prev = tr[tr.length - 2]!
  const last = tr[tr.length - 1]!
  return last.totalResponses - prev.totalResponses
})

const deltaIcon = computed(() => {
  const d = responsesDelta.value
  if (d === null) return null
  if (d > 0) return TrendingUp
  if (d < 0) return TrendingDown
  return Minus
})
const deltaTone = computed(() => {
  const d = responsesDelta.value
  if (d === null || d === 0) return 'text-surface-400 dark:text-surface-500'
  return d > 0
    ? 'text-success-600 dark:text-success-400'
    : 'text-danger-600 dark:text-danger-400'
})

const hasData = computed(() => current.value !== null)
</script>

<template>
  <div v-if="connected" class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
    <div class="flex items-center justify-between px-5 py-4 border-b border-surface-100 dark:border-surface-800">
      <div class="flex items-center gap-2.5">
        <div class="flex items-center justify-center size-7 rounded-lg bg-surface-100 dark:bg-surface-800">
          <BarChart3 class="size-3.5 text-surface-500 dark:text-surface-400" />
        </div>
        <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">
          {{ t('dashboard.jobs.stats.widget.title') }}
        </h2>
      </div>
      <NuxtLink
        :to="localePath('/dashboard/analytics')"
        class="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 no-underline inline-flex items-center gap-1 group/link"
      >
        {{ t('dashboard.jobs.stats.widget.details') }}
        <ArrowRight class="size-3 group-hover/link:translate-x-0.5 transition-transform" />
      </NuxtLink>
    </div>

    <!-- Loading skeleton -->
    <div v-if="isLoading" class="p-5 space-y-3">
      <div v-for="i in 3" :key="i" class="h-10 rounded-lg bg-surface-100 dark:bg-surface-800 animate-pulse" />
    </div>

    <div v-else-if="hasData" class="p-5 space-y-3">
      <!-- Отклики + trend arrow -->
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-surface-500 dark:text-surface-400">{{ t('dashboard.jobs.stats.widget.responses') }}</span>
        <div class="flex items-center gap-2">
          <span class="text-lg font-bold tabular-nums text-surface-900 dark:text-surface-50">{{ current?.totalResponses ?? 0 }}</span>
          <component
            :is="deltaIcon"
            v-if="deltaIcon"
            class="size-4"
            :class="deltaTone"
          />
          <span v-if="responsesDelta !== null" class="text-xs tabular-nums" :class="deltaTone">
            {{ responsesDelta > 0 ? `+${responsesDelta}` : responsesDelta }}
          </span>
        </div>
      </div>
      <!-- Наймы -->
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-surface-500 dark:text-surface-400">{{ t('dashboard.jobs.stats.widget.hires') }}</span>
        <span class="text-lg font-bold tabular-nums text-surface-900 dark:text-surface-50">{{ current?.hired ?? 0 }}</span>
      </div>
      <!-- Конверсия -->
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-surface-500 dark:text-surface-400">{{ t('dashboard.jobs.stats.widget.conversion') }}</span>
        <span class="text-lg font-bold tabular-nums text-surface-900 dark:text-surface-50">{{ current?.conversionRate ?? 0 }}%</span>
      </div>
    </div>

    <div v-else class="px-5 py-10 text-center">
      <p class="text-sm text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.stats.widget.noData') }}</p>
    </div>
  </div>
</template>
