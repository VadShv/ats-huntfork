<script setup lang="ts">
/** Под-навигация раздела «Банк вопросов». Спринт 1. */
const links = [
  { label: 'Обзор', to: '/dashboard/settings/question-bank' },
  { label: 'Вопросы', to: '/dashboard/settings/question-bank/questions' },
  { label: 'Темы', to: '/dashboard/settings/question-bank/topics' },
  { label: 'Песочница', to: '/dashboard/settings/question-bank/sandbox' },
]
const route = useRoute()
function isActive(to: string) {
  if (to.endsWith('/question-bank')) return route.path.endsWith('/question-bank')
  return route.path.startsWith(to)
}
</script>

<template>
  <nav class="flex gap-1 overflow-x-auto border-b border-surface-200 dark:border-surface-800 no-scrollbar">
    <NuxtLink
      v-for="l in links"
      :key="l.to"
      :to="l.to"
      class="px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors"
      :class="isActive(l.to)
        ? 'border-brand-500 text-brand-600 dark:text-brand-400 font-medium'
        : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'"
    >
      {{ l.label }}
    </NuxtLink>
  </nav>
</template>
