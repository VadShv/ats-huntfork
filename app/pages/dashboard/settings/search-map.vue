<script setup lang="ts">
/**
 * Обёртка раздела «Карта поиска» — заголовок + под-навигация + <NuxtPage>.
 * Подстраницы: index (Обзор) · templates · donor-companies · channels.
 * docs/tz-search-map.md §11.1
 */
import { Radar } from 'lucide-vue-next'

const route = useRoute()
const localePath = useLocalePath()

const { allowed: canView } = usePermission({ searchMap: ['view'] })

const subNav = [
  { label: 'Обзор', to: '/dashboard/settings/search-map', exact: true },
  { label: 'Шаблоны', to: '/dashboard/settings/search-map/templates', exact: false },
  { label: 'Компании-доноры', to: '/dashboard/settings/search-map/donor-companies', exact: false },
  { label: 'Каналы', to: '/dashboard/settings/search-map/channels', exact: false },
]

function isActive(to: string, exact: boolean) {
  const localized = localePath(to)
  if (exact) return route.path === localized
  return route.path === localized || route.path.startsWith(`${localized}/`)
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <header class="mb-5">
      <h1 class="flex items-center gap-2 text-xl font-semibold text-surface-900 dark:text-surface-50">
        <Radar class="size-5 text-brand-600" />
        Карта поиска
      </h1>
      <p class="mt-1 text-sm text-surface-500">
        Шаблоны карт, реестр компаний-доноров, каналы поиска.
      </p>
    </header>

    <AccessDeniedBanner
      v-if="!canView"
      message="Доступ к карте поиска есть у ролей с правом просмотра."
    />

    <template v-else>
      <nav
        class="mb-6 flex gap-1 overflow-x-auto border-b border-surface-200 dark:border-surface-800 no-scrollbar"
        role="tablist"
      >
        <NuxtLink
          v-for="item in subNav"
          :key="item.to"
          :to="localePath(item.to)"
          class="whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors no-underline"
          :class="isActive(item.to, item.exact)
            ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
            : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>

      <NuxtPage />
    </template>
  </div>
</template>
