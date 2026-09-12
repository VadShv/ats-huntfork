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
      <UiButton
        v-if="onRetry"
        size="sm"
        :icon-left="RotateCcw"
        @click="onRetry"
      >
        {{ retryLabel }}
      </UiButton>
      <UiButton
        v-if="onClose"
        variant="secondary"
        size="sm"
        :icon-left="X"
        @click="onClose"
      >
        {{ closeLabel }}
      </UiButton>
    </div>
  </div>
</template>
