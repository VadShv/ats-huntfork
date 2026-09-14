<script setup lang="ts">
/** Показ предупреждений/ошибок качества вопроса (Спринт 1). */
interface Issue { code: string, message: string }

defineProps<{
  blocking?: Issue[]
  warnings?: Issue[]
}>()
</script>

<template>
  <div v-if="(blocking?.length || warnings?.length)" class="space-y-2">
    <div v-if="blocking?.length" class="rounded-lg border border-danger-300 bg-danger-50 dark:border-danger-800 dark:bg-danger-950/40 p-3">
      <p class="text-xs font-semibold text-danger-700 dark:text-danger-300 mb-1.5">
        Не даёт опубликовать:
      </p>
      <ul class="space-y-1">
        <li v-for="b in blocking" :key="b.code" class="flex items-start gap-1.5 text-xs text-danger-700 dark:text-danger-300">
          <span aria-hidden="true">•</span><span>{{ b.message }}</span>
        </li>
      </ul>
    </div>
    <div v-if="warnings?.length" class="rounded-lg border border-warning-300 bg-warning-50 dark:border-warning-800 dark:bg-warning-950/40 p-3">
      <p class="text-xs font-semibold text-warning-700 dark:text-warning-300 mb-1.5">
        Рекомендации:
      </p>
      <ul class="space-y-1">
        <li v-for="w in warnings" :key="w.code" class="flex items-start gap-1.5 text-xs text-warning-700 dark:text-warning-300">
          <span aria-hidden="true">•</span><span>{{ w.message }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
