<script setup lang="ts">
/**
 * Центр аналитики: выбор периода — пресеты 7/30/90д + произвольный диапазон.
 * Использует общее состояние useAnalyticsFilters (period/customFrom/customTo).
 */
import { useAnalyticsFilters } from '~/composables/useAnalyticsFilters'

const { periodPreset, customFrom, customTo } = useAnalyticsFilters()

const options = [
  { value: '7d' as const, label: '7 дней' },
  { value: '30d' as const, label: '30 дней' },
  { value: '90d' as const, label: '90 дней' },
  { value: 'custom' as const, label: 'Свой' },
]
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UiSegmented
      v-model="periodPreset"
      aria-label="Период"
      :options="options"
    />
    <template v-if="periodPreset === 'custom'">
      <input
        v-model="customFrom"
        type="date"
        :max="customTo || undefined"
        class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1.5 text-xs text-surface-700 dark:text-surface-300"
      >
      <span class="text-xs text-surface-400">—</span>
      <input
        v-model="customTo"
        type="date"
        :min="customFrom || undefined"
        class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1.5 text-xs text-surface-700 dark:text-surface-300"
      >
    </template>
  </div>
</template>
