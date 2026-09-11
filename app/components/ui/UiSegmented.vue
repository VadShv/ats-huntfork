<!--
  UiSegmented — сегментированный переключатель (segmented control).

  Единый переключатель для наборов взаимоисключающих опций: периоды
  (7д/30д/90д/всё), режимы отображения и т.п. Эталон стиля — «таблетка»
  из source-tracking: контейнер rounded-xl с паддингом, активная кнопка
  залита brand и приподнята тенью.

  Использование:
    <UiSegmented
      v-model="dateRange"
      :options="[
        { value: '7d', label: '7D' },
        { value: '30d', label: '30D' },
        { value: '90d', label: '90D' },
        { value: 'all', label: 'За всё время' },
      ]"
    />

  Props:
    modelValue — текущее значение (v-model)
    options    — массив { value, label, disabled? }
    size       — sm | md (default: md)
    ariaLabel  — доступное имя группы

  Значения value могут быть строками или числами. Активная опция сравнивается
  по строгому равенству с modelValue.
-->
<script setup lang="ts" generic="T extends string | number">
interface SegmentedOption {
  value: T
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue: T
  options: SegmentedOption[]
  size?: 'sm' | 'md'
  ariaLabel?: string
}>(), {
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()

function select(opt: SegmentedOption) {
  if (opt.disabled || opt.value === props.modelValue) return
  emit('update:modelValue', opt.value)
}

const sizeClasses = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-xs',
}
</script>

<template>
  <div
    role="tablist"
    :aria-label="ariaLabel"
    class="inline-flex rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-0.5"
  >
    <button
      v-for="opt in options"
      :key="String(opt.value)"
      type="button"
      role="tab"
      :aria-selected="opt.value === modelValue"
      :disabled="opt.disabled"
      class="font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:ring-offset-surface-50 dark:focus-visible:ring-offset-surface-950"
      :class="[
        sizeClasses[size],
        opt.value === modelValue
          ? 'bg-brand-600 text-white shadow-sm'
          : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200',
      ]"
      @click="select(opt)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
