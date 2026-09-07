<script setup lang="ts">
/** Collaboration Hub (Этап 0) — липкий разделитель дня в ленте. */
import { computed } from 'vue'

const props = defineProps<{ at: number }>()
const { t, locale } = useI18n()

const label = computed(() => {
  const d = new Date(props.at)
  const now = new Date()
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(d, now)) return t('thread_ui.today')
  if (isSameDay(d, yesterday)) return t('thread_ui.yesterday')
  return d.toLocaleDateString(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    day: '2-digit', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
})
</script>

<template>
  <div class="sticky top-0 z-10 flex items-center justify-center py-1.5">
    <span class="rounded-full bg-surface-100/90 dark:bg-surface-800/90 px-2.5 py-0.5 text-[10px] font-medium text-surface-500 dark:text-surface-400 backdrop-blur">
      {{ label }}
    </span>
  </div>
</template>
