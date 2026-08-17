<script setup lang="ts">
/** Скелетон, повторяющий геометрию контента. Показывается только после 180 мс. */
withDefaults(defineProps<{ width?: string; lines?: number }>(), { width: '100%', lines: 1 })
</script>

<template>
  <div class="hf-skeleton" aria-hidden="true">
    <div
      v-for="i in lines"
      :key="i"
      class="hf-sk-line"
      :style="{ width: i === lines ? width : '100%' }"
    />
  </div>
</template>

<style scoped>
.hf-skeleton { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.hf-sk-line {
  height: 12px;
  border-radius: var(--hf-r-sm);
  background: var(--hf-surface-sunken);
  position: relative;
  overflow: hidden;
}
.hf-sk-line::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 40%, var(--hf-surface-raised) 50%, transparent 60%);
  transform: translateX(-100%);
  animation: hf-shimmer 1.6s linear infinite;
}
</style>
