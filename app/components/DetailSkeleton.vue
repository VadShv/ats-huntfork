<script setup lang="ts">
/**
 * DetailSkeleton — единый скелетон для detail-панелей (drawer, sidebar, страницы).
 * Показывает заголовок, метаданные и 2–4 карточных блока.
 */
withDefaults(defineProps<{
  blocks?: number
  withHeader?: boolean
}>(), {
  blocks: 3,
  withHeader: true,
})
</script>

<template>
  <div class="animate-pulse space-y-4 p-4 sm:p-6">
    <div v-if="withHeader" class="space-y-3">
      <div class="flex items-center gap-3">
        <div class="size-10 rounded-full bg-surface-200 dark:bg-surface-800 shrink-0" />
        <div class="flex-1 space-y-2">
          <div class="h-4 w-48 rounded bg-surface-200 dark:bg-surface-800" />
          <div class="h-3 w-32 rounded bg-surface-200 dark:bg-surface-800" />
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <div class="h-6 w-20 rounded-full bg-surface-200 dark:bg-surface-800" />
        <div class="h-6 w-16 rounded-full bg-surface-200 dark:bg-surface-800" />
        <div class="h-6 w-24 rounded-full bg-surface-200 dark:bg-surface-800" />
      </div>
    </div>
    <div
      v-for="i in blocks"
      :key="i"
      class="rounded-lg border border-surface-200 dark:border-surface-800 p-4 space-y-2"
    >
      <div class="h-3 w-24 rounded bg-surface-200 dark:bg-surface-800" />
      <div class="h-3 w-full rounded bg-surface-200 dark:bg-surface-800" />
      <div class="h-3 w-2/3 rounded bg-surface-200 dark:bg-surface-800" />
    </div>
  </div>
</template>
