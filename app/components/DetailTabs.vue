<script setup lang="ts">
/**
 * DetailTabs — единая шапка вкладок для detail-панелей.
 * - Скроллится горизонтально на mobile.
 * - Модель: v-model:tab='<key>'.
 * - Счётчик показывается, если tab.count != null.
 * - Скрывать вкладку через tab.hidden=true.
 */
export interface DetailTab {
  key: string
  label: string
  count?: number | null
  hidden?: boolean
  disabled?: boolean
}

const props = defineProps<{
  tabs: DetailTab[]
  modelValue: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
}>()

const visibleTabs = computed(() => props.tabs.filter(t => !t.hidden))
</script>

<template>
  <div
    class="flex overflow-x-auto border-b border-surface-200 dark:border-surface-800 no-scrollbar"
    role="tablist"
  >
    <button
      v-for="tab in visibleTabs"
      :key="tab.key"
      type="button"
      role="tab"
      :aria-selected="tab.key === modelValue"
      :aria-controls="`tabpanel-${tab.key}`"
      :disabled="tab.disabled"
      class="flex items-center gap-1.5 whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-surface-900"
      :class="[
        tab.key === modelValue
          ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
          : 'border-transparent text-surface-500 hover:text-surface-800 hover:border-surface-300 dark:text-surface-400 dark:hover:text-surface-100',
        tab.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      ]"
      @click="!tab.disabled && emit('update:modelValue', tab.key)"
    >
      <span>{{ tab.label }}</span>
      <span
        v-if="tab.count != null"
        class="tabular-nums inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-semibold"
        :class="tab.key === modelValue
          ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
          : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'"
      >
        {{ tab.count }}
      </span>
    </button>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { scrollbar-width: none; }
</style>
