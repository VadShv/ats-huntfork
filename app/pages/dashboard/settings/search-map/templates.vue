<script setup lang="ts">
/**
 * Шаблоны карт поиска — список + создание.
 * docs/tz-search-map.md §11.1
 */
definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })

const { allowed: canManage } = usePermission({ searchMap: ['manage_registry'] })
const localePath = useLocalePath()

const { data, refresh } = await useFetch('/api/search-map/templates')

const statusColors: Record<string, string> = {
  draft: 'variant="surface"',
  published: 'variant="success"',
  archived: 'variant="danger"',
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-300">Шаблоны карт</h2>
      <UiButton v-if="canManage" size="sm" @click="navigateTo(localePath('/dashboard/settings/search-map/templates'))">
        Создать шаблон
      </UiButton>
    </div>

    <div class="space-y-3">
      <UiCard
        v-for="template in data?.items"
        :key="template.id"
        class="cursor-pointer p-4 transition-colors hover:border-brand-300"
        @click="navigateTo(`/dashboard/settings/search-map/templates/${template.id}`)"
      >
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-medium text-surface-900 dark:text-surface-50">{{ template.name }}</span>
              <UiBadge v-if="template.isDefault" variant="brand">По умолчанию</UiBadge>
            </div>
            <p v-if="template.code" class="mt-0.5 text-xs text-surface-500">{{ template.code }} · v{{ template.version }}</p>
          </div>
          <div class="flex items-center gap-2">
            <UiBadge :variant="template.status === 'published' ? 'success' : template.status === 'archived' ? 'danger' : 'surface'">
              {{ template.status }}
            </UiBadge>
            <span class="text-xs text-surface-500">{{ template.sectionCount }} секц.</span>
          </div>
        </div>
      </UiCard>
    </div>

    <div v-if="!data?.items?.length" class="rounded-lg border border-dashed border-surface-300 p-8 text-center dark:border-surface-700">
      <p class="text-sm text-surface-500">Шаблонов пока нет.</p>
    </div>
  </div>
</template>
