<script setup lang="ts">
/**
 * EntityDetailError — единая ошибочная ветка для detail-панелей.
 * Заголовок → сообщение → Retry + опциональная кнопка «Назад/Закрыть».
 */
import { AlertTriangle, RotateCcw, X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  title?: string
  message?: string
  retryLabel?: string
  onRetry?: () => void
  onClose?: () => void
  closeLabel?: string
}>(), {
  title: 'Не удалось загрузить данные',
  retryLabel: 'Повторить',
  closeLabel: 'Закрыть',
})
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 px-6 text-center">
    <div class="mb-4 flex size-14 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300">
      <AlertTriangle class="size-7" />
    </div>
    <h3 class="text-base font-semibold text-surface-900 dark:text-surface-100 mb-1">
      {{ title }}
    </h3>
    <p v-if="message" class="text-sm text-surface-500 dark:text-surface-400 max-w-md leading-relaxed mb-5">
      {{ message }}
    </p>
    <div class="flex flex-wrap items-center justify-center gap-2">
      <button
        v-if="onRetry"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        @click="onRetry"
      >
        <RotateCcw class="size-4" />
        {{ retryLabel }}
      </button>
      <button
        v-if="onClose"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
        @click="onClose"
      >
        <X class="size-4" />
        {{ closeLabel }}
      </button>
    </div>
  </div>
</template>
