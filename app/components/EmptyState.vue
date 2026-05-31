<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(defineProps<{
  icon?: Component
  title?: string
  description?: string
  action?: { label: string; to: string }
}>(), {
  title: 'Пока ничего нет',
})
</script>

<template>
  <div class="flex flex-col items-center justify-center py-20 text-center">
    <div
      v-if="icon"
      class="mb-4 flex size-16 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800 text-surface-400 dark:text-surface-500"
    >
      <component :is="icon" class="size-8" />
    </div>
    <h3 class="text-base font-semibold text-surface-900 dark:text-surface-100 mb-1">
      {{ title }}
    </h3>
    <p
      v-if="description"
      class="text-sm text-surface-500 dark:text-surface-400 max-w-sm leading-relaxed mb-4"
    >
      {{ description }}
    </p>
    <NuxtLink
      v-if="action"
      :to="action.to"
      class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors no-underline"
    >
      {{ action.label }}
    </NuxtLink>
  </div>
</template>
