<script setup lang="ts">
/**
 * Обёртка раздела «Банк вопросов» — заголовок + под-навигация + <NuxtPage>.
 * Подстраницы: index (Обзор) · questions · topics · sandbox.
 * (docs/tz-questions-01-org-bank.md §1.8)
 */
import { Library } from 'lucide-vue-next'

const route = useRoute()
const localePath = useLocalePath()

// §1.8: пункт виден только при questionBank:['view'].
const { allowed: canView } = usePermission({ questionBank: ['view'] })

const subNav = [
  { label: 'Обзор', to: '/dashboard/settings/question-bank', exact: true },
  { label: 'Вопросы', to: '/dashboard/settings/question-bank/questions', exact: false },
  { label: 'Темы', to: '/dashboard/settings/question-bank/topics', exact: false },
  { label: 'Песочница', to: '/dashboard/settings/question-bank/sandbox', exact: false },
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
        <Library class="size-5 text-brand-600" />
        Банк вопросов
      </h1>
      <p class="mt-1 text-sm text-surface-500">
        Корпоративный справочник тем оценки, шкал, BARS-якорей и открытых вопросов.
      </p>
    </header>

    <AccessDeniedBanner
      v-if="!canView"
      message="Доступ к банку вопросов есть у ролей с правом просмотра."
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
            : 'border-transparent text-surface-500 hover:text-surface-800 hover:border-surface-300 dark:text-surface-400 dark:hover:text-surface-100'"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>

      <NuxtPage />
    </template>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { scrollbar-width: none; }
</style>
