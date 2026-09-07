<script setup lang="ts">
/** Collaboration Hub (Этап 0) — маркер «Новые сообщения» в ленте. */
const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-2 py-1">
    <div class="h-px flex-1 bg-brand-300/70 dark:bg-brand-700/70" />
    <span class="rounded-full bg-brand-100 dark:bg-brand-900/40 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300">
      {{ t('thread_ui.new_messages') }}
    </span>
    <div class="h-px flex-1 bg-brand-300/70 dark:bg-brand-700/70" />
  </div>
</template>
