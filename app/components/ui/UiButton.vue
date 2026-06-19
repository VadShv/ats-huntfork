<!--
  UiButton
  ─────────────────────────────────────────────────────────
  Универсальная кнопка дизайн-системы Huntfork.

  Использование:
    <UiButton>Сохранить</UiButton>
    <UiButton variant="secondary">Отмена</UiButton>
    <UiButton variant="danger" size="sm">Удалить</UiButton>
    <UiButton :loading="isSaving" :disabled="!isValid">Создать</UiButton>
    <UiButton to="/dashboard/jobs">Перейти</UiButton>
    <UiButton href="https://example.com" target="_blank">Открыть</UiButton>
    <UiButton variant="ghost" icon-only aria-label="Закрыть">
      <X class="size-4" />
    </UiButton>

  Props:
    variant   — primary | secondary | ghost | danger     (default: primary)
    size      — sm | md | lg                              (default: md)
    type      — button | submit | reset                   (default: button)
    loading   — boolean — показывает spinner, блокирует клики
    disabled  — boolean — стандартная блокировка
    iconOnly  — boolean — квадратная форма для иконки одной
    fullWidth — boolean — растягивается на 100% ширины
    to        — string — рендер как <NuxtLink>
    href      — string — рендер как <a>
    target    — string — для href

  Slots:
    default     — содержимое кнопки
    icon-before — иконка слева (можно подсветить состояния)
    icon-after  — иконка справа
-->

<script setup lang="ts">
import { computed } from 'vue'
import { Loader2 } from 'lucide-vue-next'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'
type ButtonType = 'button' | 'submit' | 'reset'

const props = withDefaults(defineProps<{
  variant?: Variant
  size?: Size
  type?: ButtonType
  loading?: boolean
  disabled?: boolean
  iconOnly?: boolean
  fullWidth?: boolean
  to?: string
  href?: string
  target?: string
  rel?: string
}>(), {
  variant: 'primary',
  size: 'md',
  type: 'button',
  loading: false,
  disabled: false,
  iconOnly: false,
  fullWidth: false,
})

// ─── Стили по variant'ам ──────────────────────────────────
// Текстовые/border/hover/focus — для каждого variant'а.
// Используем семантические токены (brand/danger/surface) — при смене палитры
// автоматически подхватываются новые CSS-переменные.
const variantClasses = computed<string>(() => {
  switch (props.variant) {
    case 'primary':
      return [
        'bg-brand-600 text-white border border-brand-600',
        'hover:bg-brand-700 hover:border-brand-700',
        'active:bg-brand-800',
        'shadow-sm shadow-brand-600/10',
        'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-50 dark:focus-visible:ring-offset-surface-950',
      ].join(' ')

    case 'secondary':
      return [
        'bg-white text-surface-900 border border-surface-300',
        'dark:bg-surface-900 dark:text-surface-100 dark:border-surface-700',
        'hover:bg-surface-50 hover:border-surface-400',
        'dark:hover:bg-surface-800 dark:hover:border-surface-600',
        'active:bg-surface-100 dark:active:bg-surface-700',
        'shadow-sm',
        'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-50 dark:focus-visible:ring-offset-surface-950',
      ].join(' ')

    case 'ghost':
      return [
        'bg-transparent text-surface-700 border border-transparent',
        'dark:text-surface-300',
        'hover:bg-surface-100 hover:text-surface-900',
        'dark:hover:bg-surface-800 dark:hover:text-surface-100',
        'active:bg-surface-200 dark:active:bg-surface-700',
        'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-50 dark:focus-visible:ring-offset-surface-950',
      ].join(' ')

    case 'danger':
      return [
        'bg-danger-600 text-white border border-danger-600',
        'hover:bg-danger-700 hover:border-danger-700',
        'active:bg-danger-800',
        'shadow-sm shadow-danger-600/10',
        'focus-visible:ring-2 focus-visible:ring-danger-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-50 dark:focus-visible:ring-offset-surface-950',
      ].join(' ')

    default:
      return ''
  }
})

// ─── Размеры ──────────────────────────────────────────────
// Высоты соответствуют design/tokens.ts → sizes.control.
const sizeClasses = computed<string>(() => {
  if (props.iconOnly) {
    switch (props.size) {
      case 'sm': return 'h-7 w-7 p-0'        // 28×28
      case 'md': return 'h-9 w-9 p-0'        // 36×36
      case 'lg': return 'h-11 w-11 p-0'      // 44×44
    }
  }
  switch (props.size) {
    case 'sm': return 'h-7 px-2.5 text-xs gap-1.5'      // h28 px10 text12
    case 'md': return 'h-9 px-3.5 text-sm gap-2'        // h36 px14 text14
    case 'lg': return 'h-11 px-4.5 text-base gap-2'     // h44 px18 text16
  }
})

// ─── Состояния (disabled/loading) ─────────────────────────
const isDisabled = computed(() => props.disabled || props.loading)

const stateClasses = computed<string>(() => {
  return isDisabled.value
    ? 'opacity-50 cursor-not-allowed pointer-events-none'
    : 'cursor-pointer'
})

// ─── Финальный набор классов ──────────────────────────────
const buttonClasses = computed<string>(() => [
  // Base
  'inline-flex items-center justify-center',
  'font-medium rounded-lg',
  'transition-colors duration-150',
  'select-none',
  'outline-none',
  // Variant
  variantClasses.value,
  // Size
  sizeClasses.value,
  // State
  stateClasses.value,
  // Full width
  props.fullWidth ? 'w-full' : '',
].filter(Boolean).join(' '))

// ─── Какой компонент рендерим: button | NuxtLink | a ──────
const componentTag = computed(() => {
  if (props.disabled || props.loading) return 'button'
  if (props.to) return resolveComponent('NuxtLink')
  if (props.href) return 'a'
  return 'button'
})

// Атрибуты для каждого варианта
const componentProps = computed<Record<string, unknown>>(() => {
  if (props.to && !isDisabled.value) {
    return { to: props.to }
  }
  if (props.href && !isDisabled.value) {
    return {
      href: props.href,
      target: props.target,
      rel: props.rel ?? (props.target === '_blank' ? 'noopener noreferrer' : undefined),
    }
  }
  return { type: props.type, disabled: isDisabled.value }
})

// Размер иконки spinner'а под размер кнопки
const spinnerSize = computed(() => {
  switch (props.size) {
    case 'sm': return 14
    case 'md': return 16
    case 'lg': return 18
  }
})
</script>

<template>
  <component
    :is="componentTag"
    :class="buttonClasses"
    v-bind="componentProps"
  >
    <!-- Spinner перекрывает содержимое в loading-режиме -->
    <Loader2
      v-if="loading"
      :size="spinnerSize"
      class="animate-spin shrink-0"
      aria-hidden="true"
    />
    <slot v-else name="icon-before" />

    <!-- Основной контент скрывается только в icon-only + loading -->
    <span
      v-if="!iconOnly || !loading"
      :class="[
        'inline-flex items-center',
        loading && !iconOnly ? 'opacity-70' : ''
      ]"
    >
      <slot />
    </span>

    <slot v-if="!loading" name="icon-after" />
  </component>
</template>
