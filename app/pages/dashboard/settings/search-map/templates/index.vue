<script setup lang="ts">
/**
 * Шаблоны карт поиска — список + создание.
 * docs/tz-search-map.md §11.1
 *
 * ВАЖНО: файл лежит в templates/index.vue, а не templates.vue. Иначе Nuxt делает
 * templates.vue родительским роутом для templates/[id].vue, и без <NuxtPage/>
 * переход на /templates/new или /templates/<id> меняет URL, но ничего не рендерит.
 */
definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })

const { allowed: canManage } = usePermission({ searchMap: ['manage_registry'] })
const localePath = useLocalePath()

const { data } = await useFetch('/api/search-map/templates', {
  headers: useRequestHeaders(['cookie']),
})

// Навигация — в script, а не в шаблоне: так работает и типизация, и
// единый стиль с остальными страницами настроек (pipelines/*).
function openTemplate(id: string) {
  return navigateTo(localePath(`/dashboard/settings/search-map/templates/${id}`))
}
function createTemplate() {
  return navigateTo(localePath('/dashboard/settings/search-map/templates/new'))
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-300">Шаблоны карт</h2>
      <UiButton v-if="canManage" size="sm" @click="createTemplate">
        Создать шаблон
      </UiButton>
    </div>

    <div class="space-y-3">
      <UiCard
        v-for="template in data?.items"
        :key="template.id"
        class="cursor-pointer p-4 transition-colors hover:border-brand-300"
        @click="openTemplate(template.id)"
      >
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-medium text-surface-900 dark:text-surface-50">{{ template.name }}</span>
              <UiBadge v-if="template.isDefault" tone="brand">По умолчанию</UiBadge>
            </div>
            <p v-if="template.code" class="mt-0.5 text-xs text-surface-500">{{ template.code }} · v{{ template.version }}</p>
          </div>
          <div class="flex items-center gap-2">
            <UiBadge :tone="template.status === 'published' ? 'success' : template.status === 'archived' ? 'danger' : 'neutral'">
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
