<script setup lang="ts">
/**
 * UiSelect — нативный селект Huntfork UI (визуально совместим с UiInput).
 *
 * Для поискового списка — см. UiSearchSelect (следующая итерация).
 *
 * Возможности:
 *  - v-model: string | number | null
 *  - options: { label, value, disabled? }[]  ИЛИ
 *    options: string[] (тогда label=value)
 *  - placeholder (пустой `value=""` option в начале)
 *  - clearable — показывает крестик для сброса (только если modelValue не пустой)
 *  - размеры sm/md/lg, состояния default/error/success, label, hint, errorMessage
 */
import { computed } from 'vue'
import { ChevronDown, X } from 'lucide-vue-next'

type SelectSize = 'sm' | 'md' | 'lg'
type SelectState = 'default' | 'error' | 'success'

interface Option {
  label: string
  value: string | number
  disabled?: boolean
}

interface Props {
  modelValue?: string | number | null
  options: Array<Option | string | number>
  placeholder?: string
  size?: SelectSize
  state?: SelectState
  label?: string
  hint?: string
  errorMessage?: string
  disabled?: boolean
  required?: boolean
  clearable?: boolean
  id?: string
  block?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  state: 'default',
  block: true,
  clearable: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number | null]
  change: [value: string | number | null]
}>()

const normalizedOptions = computed<Option[]>(() =>
  (props.options || []).map((opt) =>
    typeof opt === 'object'
      ? opt
      : { label: String(opt), value: opt },
  ),
)

const effectiveState = computed<SelectState>(() => (props.errorMessage ? 'error' : props.state))

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm': return 'px-2.5 py-1.5 text-xs pr-8'
    case 'lg': return 'px-4 py-3 text-base pr-11'
    case 'md':
    default: return 'px-3 py-2 text-sm pr-9'
  }
})

const stateClasses = computed(() => {
  switch (effectiveState.value) {
    case 'error': return 'border-danger-400 dark:border-danger-700 focus:ring-danger-500 focus:border-danger-500'
    case 'success': return 'border-success-400 dark:border-success-700 focus:ring-success-500 focus:border-success-500'
    default: return 'border-surface-300 dark:border-surface-700 focus:ring-brand-500 focus:border-brand-500'
  }
})

const selectClasses = computed(() => [
  'appearance-none rounded-lg border bg-white dark:bg-surface-900',
  'text-surface-900 dark:text-surface-100',
  'focus:outline-none focus:ring-2 transition-colors',
  'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-50 dark:disabled:bg-surface-950',
  props.block ? 'w-full' : '',
  sizeClasses.value,
  stateClasses.value,
])

const iconSize = computed(() => (props.size === 'lg' ? 18 : props.size === 'sm' ? 14 : 16))

const iconPositionClass = computed(() => {
  switch (props.size) {
    case 'sm': return 'right-2'
    case 'lg': return 'right-3.5'
    default: return 'right-2.5'
  }
})

function onChange(e: Event) {
  const target = e.target as HTMLSelectElement
  const raw = target.value
  // вернём правильный тип, если в options был number
  const found = normalizedOptions.value.find((o) => String(o.value) === raw)
  const next = found ? found.value : (raw === '' ? null : raw)
  emit('update:modelValue', next)
  emit('change', next)
}

function clear() {
  emit('update:modelValue', null)
  emit('change', null)
}

const hasValue = computed(() => props.modelValue !== null && props.modelValue !== undefined && props.modelValue !== '')
</script>

<template>
  <div :class="block ? 'w-full' : 'inline-flex flex-col'">
    <label
      v-if="label"
      :for="id"
      class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5"
    >
      {{ label }}
      <span v-if="required" class="text-danger-500" aria-hidden="true">*</span>
    </label>

    <div class="relative">
      <select
        :id="id"
        :value="modelValue ?? ''"
        :disabled="disabled"
        :required="required"
        :aria-invalid="effectiveState === 'error' || undefined"
        :class="selectClasses"
        @change="onChange"
      >
        <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
        <option
          v-for="opt in normalizedOptions"
          :key="String(opt.value)"
          :value="opt.value"
          :disabled="opt.disabled"
        >
          {{ opt.label }}
        </option>
      </select>

      <button
        v-if="clearable && hasValue && !disabled"
        type="button"
        :class="['absolute top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 cursor-pointer', iconPositionClass]"
        :style="{ right: 'calc(' + (size === 'sm' ? '20px' : size === 'lg' ? '36px' : '28px') + ')' }"
        :aria-label="'Очистить'"
        @click.stop="clear"
      >
        <X :size="iconSize" />
      </button>

      <span
        :class="['absolute top-1/2 -translate-y-1/2 pointer-events-none text-surface-400 dark:text-surface-500', iconPositionClass]"
        aria-hidden="true"
      >
        <ChevronDown :size="iconSize" />
      </span>
    </div>

    <p
      v-if="errorMessage"
      class="mt-1.5 text-xs text-danger-600 dark:text-danger-400"
    >
      {{ errorMessage }}
    </p>
    <p
      v-else-if="hint"
      class="mt-1.5 text-xs text-surface-500 dark:text-surface-400"
    >
      {{ hint }}
    </p>
  </div>
</template>
