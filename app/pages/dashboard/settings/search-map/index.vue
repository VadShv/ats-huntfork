<script setup lang="ts">
/**
 * Обзор «Карта поиска» — карточки-цифры + топ-10 доноров.
 * docs/tz-search-map.md §11.1
 */
definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })

const { data: overview, refresh } = await useFetch('/api/search-map/overview')
</script>

<template>
  <div>
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UiCard class="p-4">
        <p class="text-sm text-surface-500">Шаблонов</p>
        <p class="mt-1 text-2xl font-semibold text-surface-900 dark:text-surface-50">{{ overview?.templates ?? 0 }}</p>
      </UiCard>
      <UiCard class="p-4">
        <p class="text-sm text-surface-500">Компаний-доноров</p>
        <p class="mt-1 text-2xl font-semibold text-surface-900 dark:text-surface-50">{{ overview?.donors ?? 0 }}</p>
      </UiCard>
      <UiCard class="p-4">
        <p class="text-sm text-surface-500">Каналов</p>
        <p class="mt-1 text-2xl font-semibold text-surface-900 dark:text-surface-50">{{ overview?.channels ?? 0 }}</p>
      </UiCard>
      <UiCard class="p-4">
        <p class="text-sm text-surface-500">Карт по статусам</p>
        <p class="mt-1 text-2xl font-semibold text-surface-900 dark:text-surface-50">
          {{ Object.values(overview?.mapsByStatus ?? {}).reduce((a: number, b: number) => a + b, 0) }}
        </p>
      </UiCard>
    </div>

    <div v-if="overview?.topDonors?.length" class="mt-6">
      <h2 class="mb-3 text-sm font-semibold text-surface-700 dark:text-surface-300">
        Топ доноров по «работает»
      </h2>
      <div class="space-y-2">
        <div
          v-for="donor in overview.topDonors"
          :key="donor.id"
          class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-2 dark:border-surface-800"
        >
          <span class="text-sm font-medium text-surface-900 dark:text-surface-50">{{ donor.canonicalName }}</span>
          <UiBadge variant="success">{{ donor.workingCount }}</UiBadge>
        </div>
      </div>
    </div>

    <div v-else class="mt-6 rounded-lg border border-dashed border-surface-300 p-8 text-center dark:border-surface-700">
      <p class="text-sm text-surface-500">Пока нет доноров со статусом «работает».</p>
    </div>
  </div>
</template>
