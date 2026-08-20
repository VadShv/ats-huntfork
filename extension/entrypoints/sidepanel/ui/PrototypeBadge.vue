<script setup lang="ts">
/**
 * П0: бейдж «Прототип» — обязательная маркировка экранов и блоков,
 * работающих на демо-данных, а не на реальном сервере.
 */
withDefaults(defineProps<{ label?: string }>(), {
  label: 'Прототип · данные не настоящие',
})
</script>

<template>
  <span class="proto-badge" role="status">
    <span class="proto-dot" aria-hidden="true" />
    {{ label }}
  </span>
</template>

<style scoped>
.proto-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 8px;
  border-radius: var(--hf-r-full, 999px);
  border: 1px dashed var(--hf-warn);
  background: var(--hf-warn-muted);
  color: var(--hf-warn);
  font-size: var(--hf-t-xs);
  font-weight: var(--hf-fw-semibold);
  line-height: 1.4;
  white-space: nowrap;
}
.proto-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentcolor;
  flex: none;
}
</style>
