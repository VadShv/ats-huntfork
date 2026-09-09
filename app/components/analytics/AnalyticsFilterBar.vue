<script setup lang="ts">
/**
 * Центр аналитики: единый sticky-фильтр-бар для всех страниц.
 * Период (DateRangePicker) + опциональные фильтры (вакансия/источник/сортировка) +
 * пресеты. Специфичные фильтры страниц (pipeline и т.п.) — через слот #extra.
 * Экспорт-кнопки — через слот #actions.
 */
import { Filter as FilterIcon } from 'lucide-vue-next'
import { useAnalyticsFilters } from '~/composables/useAnalyticsFilters'

withDefaults(defineProps<{
  showJob?: boolean
  showSource?: boolean
}>(), {
  showJob: false,
  showSource: false,
})

const { jobId, source } = useAnalyticsFilters()

const { data: jobsData } = useFetch('/api/jobs', {
  key: 'analytics-filterbar-jobs',
  headers: useRequestHeaders(['cookie']),
  query: { limit: 100 },
})
const jobs = computed(() => (jobsData.value as any)?.data ?? [])

const sourceOptions = [
  { value: '', label: 'Все источники' },
  { value: 'hh', label: 'hh.ru' },
  { value: 'manual', label: 'Вручную' },
]
</script>

<template>
  <div class="sticky top-0 z-10 -mx-1 px-1 py-2 bg-surface-50/95 dark:bg-surface-950/95 backdrop-blur border-b border-surface-200/60 dark:border-surface-800/60">
    <div class="flex flex-wrap items-center gap-2">
      <FilterIcon class="w-4 h-4 text-surface-400 shrink-0" />

      <AnalyticsDateRangePicker />

      <slot name="extra" />

      <select
        v-if="showJob"
        v-model="jobId"
        class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs text-surface-700 dark:text-surface-300 max-w-56"
      >
        <option :value="undefined">Все вакансии</option>
        <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }}</option>
      </select>

      <select
        v-if="showSource"
        v-model="source"
        class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs text-surface-700 dark:text-surface-300"
      >
        <option v-for="opt in sourceOptions" :key="opt.value" :value="opt.value || undefined">{{ opt.label }}</option>
      </select>

      <div class="ml-auto flex items-center gap-2">
        <slot name="actions" />
        <AnalyticsPresetSelector />
      </div>
    </div>
  </div>
</template>
