<script setup lang="ts">
import { formatMoney } from '~~/shared/aiUsage/cost'

const props = defineProps<{
  jobId: string
}>()

const { data } = useFetch(`/api/jobs/${props.jobId}/search-map/stats`, {
  key: () => `search-map-stats-${props.jobId}`,
})

// Расход ИИ на генерацию карты (docs/tz-ai-usage.md §8.3) — только при aiUsage:view_own+.
const { allowed: canSeeAiUsage } = usePermission({ aiUsage: ['view_own'] })
const aiUsage = ref<any>(null)
watch(canSeeAiUsage, async (ok) => {
  if (!ok) return
  aiUsage.value = await $fetch(`/api/jobs/${props.jobId}/search-map/ai-usage`).catch(() => null)
}, { immediate: true })
const aiLast = computed(() => {
  const ops: any[] = aiUsage.value?.operations ?? []
  const last = ops.map(o => o.lastAt).filter(Boolean).sort().at(-1)
  return last ? new Date(last).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null
})
const aiTypical = computed(() => {
  const t: any[] = aiUsage.value?.typical ?? []
  const traces = t.reduce((s, o) => s + (o.traces ?? 0), 0)
  const cost = t.reduce((s, o) => s + (o.cost ?? 0), 0)
  return traces && 'cost' in (t[0] ?? {}) ? cost / traces : null
})
const aiCurrency = computed(() => (aiUsage.value?.currency ?? 'RUB') as 'RUB' | 'USD')

const statusLabels: Record<string, string> = {
  untested: 'Не проверена', in_progress: 'В работе', working: 'Работает', rejected: 'Отклонена',
}
</script>

<template>
  <div class="space-y-2">
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <div class="rounded-lg border border-surface-200 p-3 dark:border-surface-800">
      <p class="text-xs text-surface-500">Гипотез</p>
      <p class="text-xl font-semibold text-surface-900 dark:text-surface-50">{{ data?.segmentsTotal ?? 0 }}</p>
    </div>
    <div class="rounded-lg border border-surface-200 p-3 dark:border-surface-800">
      <p class="text-xs text-surface-500">Доноров</p>
      <p class="text-xl font-semibold text-surface-900 dark:text-surface-50">{{ data?.donorsTotal ?? 0 }}</p>
    </div>
    <div class="rounded-lg border border-surface-200 p-3 dark:border-surface-800">
      <p class="text-xs text-surface-500">Работающих</p>
      <p class="text-xl font-semibold text-success-600">{{ data?.segmentsWorking ?? 0 }}</p>
    </div>
    <div class="rounded-lg border border-surface-200 p-3 dark:border-surface-800">
      <p class="text-xs text-surface-500">hh-поисков</p>
      <p class="text-xl font-semibold text-surface-900 dark:text-surface-50">{{ data?.hhSearchesTotal ?? 0 }}</p>
    </div>
  </div>
  <p v-if="aiUsage && aiUsage.totals.calls > 0" class="text-xs text-surface-500 tabular-nums">
    Генерация ИИ: {{ aiUsage.totals.traces }} запусков
    <template v-if="'cost' in aiUsage.totals"> · {{ formatMoney(aiUsage.totals.cost, aiCurrency) }}</template>
    <template v-if="aiLast"> · последний {{ aiLast }}</template>
    <template v-if="aiTypical !== null"> · обычно ≈ {{ formatMoney(aiTypical, aiCurrency) }} за запуск</template>
    · <NuxtLink :to="{ path: '/dashboard/ai-usage', query: { period: '90d', jobId, feature: 'search_map' } }" class="text-brand-600 hover:underline">подробнее</NuxtLink>
  </p>
  </div>
</template>
