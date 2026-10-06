<script setup lang="ts">
const props = defineProps<{
  jobId: string
}>()

const { data } = useFetch(`/api/jobs/${props.jobId}/search-map/stats`, {
  key: () => `search-map-stats-${props.jobId}`,
})

const statusLabels: Record<string, string> = {
  untested: 'Не проверена', in_progress: 'В работе', working: 'Работает', rejected: 'Отклонена',
}
</script>

<template>
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
</template>
