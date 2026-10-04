<script setup lang="ts">
/**
 * Каналы поиска — список системных и custom-каналов.
 * docs/tz-search-map.md §11.1
 */
definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })

const { allowed: canManage } = usePermission({ searchMap: ['manage_registry'] })

const { data, refresh } = await useFetch('/api/search-map/channels')

const priorityLabel: Record<string, string> = { high: 'Высокий', medium: 'Средний', low: 'Низкий' }
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-300">Каналы поиска</h2>
      <UiButton v-if="canManage" size="sm">Добавить канал</UiButton>
    </div>

    <div class="space-y-2">
      <div
        v-for="channel in data?.items"
        :key="channel.id"
        class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3 dark:border-surface-800"
      >
        <div class="flex items-center gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-medium text-surface-900 dark:text-surface-50">{{ channel.name }}</span>
              <UiBadge v-if="channel.isSystem" variant="surface">Системный</UiBadge>
              <UiBadge v-if="!channel.isActive" variant="danger">Неактивен</UiBadge>
            </div>
            <p class="mt-0.5 text-xs text-surface-500">{{ channel.code }}</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-surface-500">{{ priorityLabel[channel.defaultPriority] }}</span>
          <span v-if="channel.targetSite" class="text-xs text-brand-600">site:{{ channel.targetSite }}</span>
        </div>
      </div>
    </div>

    <div v-if="!data?.items?.length" class="mt-4 rounded-lg border border-dashed border-surface-300 p-8 text-center dark:border-surface-700">
      <p class="text-sm text-surface-500">Каналы загружаются…</p>
    </div>
  </div>
</template>
