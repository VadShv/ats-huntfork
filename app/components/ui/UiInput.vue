<script setup lang="ts">
/**
 * UiInput — базовое поле ввода Huntfork UI.
 *
 * Возможности:
 *  - v-model: string | number
 *  - типы: text/email/password/number/search/tel/url
 *  - состояния: default | error | success
 *  - размеры: sm | md | lg
 *  - иконка слева/справа (slot prefix/suffix) или icon-only через props
 *  - hint / errorMessage под полем
 *  - disabled / readonly / loading
 *
 * Визуально совместим с существующими полями (rounded-lg, border-surface-300,
 * focus ring brand-500). Меняем 0 пикселей, только формализуем.
 */
import { computed, useAttrs } from 'vue'
import type { Component } from 'vue'

type InputSize = 'sm' | 'md' | 'lg'
type InputState = 'default' | 'error' | 'success'
type InputType = 'text' | 'email' | 'password' | 'number' | 'search' | 'tel' | 'url'

interface Props {
  modelValue?: string | number | null
  type?: InputType
  size?: InputSize
  state?: InputState
  placeholder?: string
  label?: string
  hint?: string
  errorMessage?: string
  /** Иконка слева — компонент из lucide-vue-next */
  iconLeft?: Component
  /** Иконка справа — компонент из lucide-vue-next */
  iconRight?: Component
  disabled?: boolean
  readonly?: boolean
  loading?: boolean
  required?: boolean
  id?: string
  /** Растягивать ли на всю ширину родителя (default: true) */
  block?: boolean
  /** autocomplete атрибут */
  autocomplete?: string
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  size: 'md',
  state: 'default',
  block: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
  keydown: [event: KeyboardEvent]
  keyup: [event: KeyboardEvent]
}>()

const attrs = useAttrs()

// Реальное состояние = errorMessage перебивает state
const effectiveState = computed<InputState>(() => {
  if (props.errorMessage) return 'error'
  return props.state
})

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'px-2.5 py-1.5 text-xs'
    case 'lg':
      return 'px-4 py-3 text-base'
    case 'md':
    default:
      return 'px-3 py-2 text-sm'
  }
})

const iconSize = computed(() => {
  switch (props.size) {
    case 'sm': return 14
    case 'lg': return 20
    case 'md':
    default: return 16
  }
})

const paddingForIcons = computed(() => {
  // когда есть иконка, добавляем доп. отступ
  const left = props.iconLeft ? (props.size === 'sm' ? 'pl-8' : props.size === 'lg' ? 'pl-11' : 'pl-9') : ''
  const right = (props.iconRight || props.loading) ? (props.size === 'sm' ? 'pr-8' : props.size === 'lg' ? 'pr-11' : 'pr-9') : ''
  return [left, right].filter(Boolean).join(' ')
})

const stateClasses = computed(() => {
  switch (effectiveState.value) {
    case 'error':
      return 'border-danger-400 dark:border-danger-700 focus:ring-danger-500 focus:border-danger-500'
    case 'success':
      return 'border-success-400 dark:border-success-700 focus:ring-success-500 focus:border-success-500'
    case 'default':
    default:
      return 'border-surface-300 dark:border-surface-700 focus:ring-brand-500 focus:border-brand-500'
  }
})

const inputClasses = computed(() => [
  'rounded-lg border bg-white dark:bg-surface-900',
  'text-surface-900 dark:text-surface-100',
  'placeholder:text-surface-400 dark:placeholder:text-surface-500',
  'focus:outline-none focus:ring-2 transition-colors',
  'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-50 dark:disabled:bg-surface-950',
  'read-only:cursor-default read-only:bg-surface-50 dark:read-only:bg-surface-950',
  props.block ? 'w-full' : '',
  sizeClasses.value,
  paddingForIcons.value,
  stateClasses.value,
])

const iconLeftPositionClass = computed(() => {
  switch (props.size) {
    case 'sm': return 'left-2.5'
    case 'lg': return 'left-3.5'
    case 'md':
    default: return 'left-3'
  }
})

const iconRightPositionClass = computed(() => {
  switch (props.size) {
    case 'sm': return 'right-2.5'
    case 'lg': return 'right-3.5'
    case 'md':
    default: return 'right-3'
  }
})

const iconColorClass = computed(() => {
  switch (effectiveState.value) {
    case 'error': return 'text-danger-500 dark:text-danger-400'
    case 'success': return 'text-success-500 dark:text-success-400'
    default: return 'text-surface-400 dark:text-surface-500'
  }
})

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  const v = props.type === 'number' && target.value !== '' ? Number(target.value) : target.value
  emit('update:modelValue', v)
}

defineOptions({ inheritAttrs: false })
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
      <span
        v-if="iconLeft"
        :class="['absolute top-1/2 -translate-y-1/2 pointer-events-none', iconLeftPositionClass, iconColorClass]"
        aria-hidden="true"
      >
        <component :is="iconLeft" :size="iconSize" />
      </span>

      <input
        :id="id"
        :type="type"
        :value="modelValue ?? ''"
        :placeholder="placeholder"
        :disabled="disabled || loading"
        :readonly="readonly"
        :required="required"
        :autocomplete="autocomplete"
        :aria-invalid="effectiveState === 'error' || undefined"
        :aria-describedby="errorMessage ? `${id || ''}-error` : (hint ? `${id || ''}-hint` : undefined)"
        :class="inputClasses"
        v-bind="attrs"
        @input="onInput"
        @blur="emit('blur', $event)"
        @focus="emit('focus', $event)"
        @keydown="emit('keydown', $event)"
        @keyup="emit('keyup', $event)"
      />

      <span
        v-if="loading"
        :class="['absolute top-1/2 -translate-y-1/2 pointer-events-none', iconRightPositionClass, iconColorClass]"
        aria-hidden="true"
      >
        <svg
          class="animate-spin"
          :width="iconSize"
          :height="iconSize"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
      </span>
      <span
        v-else-if="iconRight"
        :class="['absolute top-1/2 -translate-y-1/2 pointer-events-none', iconRightPositionClass, iconColorClass]"
        aria-hidden="true"
      >
        <component :is="iconRight" :size="iconSize" />
      </span>
    </div>

    <p
      v-if="errorMessage"
      :id="`${id || ''}-error`"
      class="mt-1.5 text-xs text-danger-600 dark:text-danger-400"
    >
      {{ errorMessage }}
    </p>
    <p
      v-else-if="hint"
      :id="`${id || ''}-hint`"
      class="mt-1.5 text-xs text-surface-500 dark:text-surface-400"
    >
      {{ hint }}
    </p>
  </div>
</template>
