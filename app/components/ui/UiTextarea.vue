<script setup lang="ts">
/**
 * UiTextarea — базовое многострочное поле ввода Huntfork UI.
 *
 * Возможности:
 *  - v-model: string
 *  - состояния: default | error | success
 *  - размеры: sm | md | lg
 *  - rows (фикс. высота) или autosize (растёт под контент)
 *  - hint / errorMessage под полем
 *  - disabled / readonly
 *
 * Визуально согласован с UiInput (rounded-lg, border-surface-300,
 * focus ring brand-500). Заводится в Спринте 0 модуля вопросов
 * (docs/tz-questions-01-org-bank.md §0.5), т.к. нужен всем спринтам.
 */
import { computed, nextTick, onMounted, ref, watch, useAttrs } from 'vue'

type TextareaSize = 'sm' | 'md' | 'lg'
type TextareaState = 'default' | 'error' | 'success'

interface Props {
  modelValue?: string | null
  size?: TextareaSize
  state?: TextareaState
  placeholder?: string
  label?: string
  hint?: string
  errorMessage?: string
  /** Число строк (игнорируется при autosize) */
  rows?: number
  /** Автовысота под контент */
  autosize?: boolean
  /** Максимальная высота при autosize, px (0 = без лимита) */
  maxHeight?: number
  disabled?: boolean
  readonly?: boolean
  required?: boolean
  id?: string
  /** Растягивать на всю ширину (default: true) */
  block?: boolean
  /** Показывать счётчик символов (нужен maxlength) */
  showCount?: boolean
  maxlength?: number
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  state: 'default',
  rows: 4,
  autosize: false,
  maxHeight: 0,
  block: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
  keydown: [event: KeyboardEvent]
}>()

const attrs = useAttrs()
defineOptions({ inheritAttrs: false })

const textareaRef = ref<HTMLTextAreaElement | null>(null)

const effectiveState = computed<TextareaState>(() => {
  if (props.errorMessage) return 'error'
  return props.state
})

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm': return 'px-2.5 py-1.5 text-xs'
    case 'lg': return 'px-4 py-3 text-base'
    case 'md':
    default: return 'px-3 py-2 text-sm'
  }
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

const textareaClasses = computed(() => [
  'rounded-lg border bg-white dark:bg-surface-900',
  'text-surface-900 dark:text-surface-100',
  'placeholder:text-surface-400 dark:placeholder:text-surface-500',
  'focus:outline-none focus:ring-2 transition-colors',
  'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-50 dark:disabled:bg-surface-950',
  'read-only:cursor-default read-only:bg-surface-50 dark:read-only:bg-surface-950',
  props.autosize ? 'resize-none overflow-hidden' : 'resize-y',
  props.block ? 'w-full' : '',
  sizeClasses.value,
  stateClasses.value,
])

const count = computed(() => (props.modelValue ?? '').length)

function resize() {
  if (!props.autosize) return
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  let h = el.scrollHeight
  if (props.maxHeight && h > props.maxHeight) {
    h = props.maxHeight
    el.style.overflowY = 'auto'
  }
  else {
    el.style.overflowY = 'hidden'
  }
  el.style.height = `${h}px`
}

function onInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
  if (props.autosize) nextTick(resize)
}

watch(() => props.modelValue, () => {
  if (props.autosize) nextTick(resize)
})

onMounted(() => {
  if (props.autosize) resize()
})
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

    <textarea
      :id="id"
      ref="textareaRef"
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      :rows="autosize ? undefined : rows"
      :disabled="disabled"
      :readonly="readonly"
      :required="required"
      :maxlength="maxlength"
      :aria-invalid="effectiveState === 'error' || undefined"
      :aria-describedby="errorMessage ? `${id || ''}-error` : (hint ? `${id || ''}-hint` : undefined)"
      :class="textareaClasses"
      v-bind="attrs"
      @input="onInput"
      @blur="emit('blur', $event)"
      @focus="emit('focus', $event)"
      @keydown="emit('keydown', $event)"
    />

    <div class="mt-1.5 flex items-start justify-between gap-2">
      <p
        v-if="errorMessage"
        :id="`${id || ''}-error`"
        class="text-xs text-danger-600 dark:text-danger-400"
      >
        {{ errorMessage }}
      </p>
      <p
        v-else-if="hint"
        :id="`${id || ''}-hint`"
        class="text-xs text-surface-500 dark:text-surface-400"
      >
        {{ hint }}
      </p>
      <span v-else aria-hidden="true" />

      <span
        v-if="showCount && maxlength"
        class="shrink-0 text-xs tabular-nums"
        :class="count >= maxlength ? 'text-danger-500' : 'text-surface-400 dark:text-surface-500'"
      >
        {{ count }}/{{ maxlength }}
      </span>
    </div>
  </div>
</template>
