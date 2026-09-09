<script setup lang="ts">
/**
 * Центр аналитики: общая навигация разделов.
 * Используется на всех страницах /dashboard/analytics/*.
 */
const localePath = useLocalePath()

const sections = [
  { to: '/dashboard/analytics', label: 'Обзор' },
  { to: '/dashboard/analytics/funnel', label: 'Воронка' },
  { to: '/dashboard/analytics/vacancies', label: 'Вакансии' },
  { to: '/dashboard/analytics/recruiters', label: 'Рекрутеры' },
  { to: '/dashboard/analytics/sources', label: 'Источники' },
]
</script>

<template>
  <nav class="flex items-center gap-1 rounded-xl bg-surface-100 dark:bg-surface-800 p-1 flex-wrap">
    <NuxtLink
      v-for="s in sections"
      :key="s.to"
      :to="localePath(s.to)"
      class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
      :class="$route.path === localePath(s.to)
        ? 'bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-50 shadow-xs'
        : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200'"
    >
      {{ s.label }}
    </NuxtLink>
  </nav>
</template>
