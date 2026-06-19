<script setup lang="ts">
/**
 * UiBadge — компактный значок для статусов, счётчиков, тегов.
 *
 * Варианты:
 *  - solid  — закрашенный фон
 *  - soft   — приглушённый (tint+text)  ← дефолт, соответствует текущему стилю
 *  - outline — только обводка
 *
 * Тон (color):
 *  - neutral | brand | success | warning | danger | info | accent
 *
 * Размеры: sm | md
 *
 * Опции:
 *  - icon   — лидирующая иконка (lucide-vue-next компонент)
 *  - dot    — точка-индикатор слева
 *  - removable — кнопка крестика (emit('remove'))
 *
 * Application-статусы можно мапить через утилитарные хелперы в Showcase.
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import { X } from 'lucide-vue-next'

type BadgeVariant = 'solid' | 'soft' | 'outline'
type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'accent'
type BadgeSize = 'sm' | 'md'

interface Props {
  variant?: BadgeVariant
  tone?: BadgeTone
  size?: BadgeSize
  icon?: Component
  dot?: boolean
  removable?: boolean
  /** Делать рамку округлой (pill) */
  pill?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'soft',
  tone: 'neutral',
  size: 'sm',
  pill: true,
})

const emit = defineEmits<{ remove: [] }>()

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'md': return 'text-xs px-2.5 py-1 gap-1.5'
    case 'sm':
    default: return 'text-[11px] px-2 py-0.5 gap-1'
  }
})

const iconSize = computed(() => (props.size === 'md' ? 12 : 10))

const variantToneClass = computed(() => {
  const tone = props.tone
  if (props.variant === 'solid') {
    switch (tone) {
      case 'brand': return 'bg-brand-600 text-white'
      case 'success': return 'bg-success-600 text-white'
      case 'warning': return 'bg-warning-600 text-white'
      case 'danger': return 'bg-danger-600 text-white'
      case 'info': return 'bg-info-600 text-white'
      case 'accent': return 'bg-accent-600 text-white'
      case 'neutral':
      default: return 'bg-surface-700 dark:bg-surface-300 text-white dark:text-surface-900'
    }
  }
  if (props.variant === 'outline') {
    switch (tone) {
      case 'brand': return 'border border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-300'
      case 'success': return 'border border-success-300 dark:border-success-700 text-success-700 dark:text-success-300'
      case 'warning': return 'border border-warning-300 dark:border-warning-700 text-warning-700 dark:text-warning-300'
      case 'danger': return 'border border-danger-300 dark:border-danger-700 text-danger-700 dark:text-danger-300'
      case 'info': return 'border border-info-300 dark:border-info-700 text-info-700 dark:text-info-300'
      case 'accent': return 'border border-accent-300 dark:border-accent-700 text-accent-700 dark:text-accent-300'
      case 'neutral':
      default: return 'border border-surface-300 dark:border-surface-700 text-surface-700 dark:text-surface-300'
    }
  }
  // soft (default)
  switch (tone) {
    case 'brand': return 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
    case 'success': return 'bg-success-50 dark:bg-success-950/40 text-success-700 dark:text-success-300'
    case 'warning': return 'bg-warning-50 dark:bg-warning-950/40 text-warning-700 dark:text-warning-300'
    case 'danger': return 'bg-danger-50 dark:bg-danger-950/40 text-danger-700 dark:text-danger-300'
    case 'info': return 'bg-info-50 dark:bg-info-950/40 text-info-700 dark:text-info-300'
    case 'accent': return 'bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-300'
    case 'neutral':
    default: return 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300'
  }
})

const dotClass = computed(() => {
  switch (props.tone) {
    case 'brand': return 'bg-brand-500'
    case 'success': return 'bg-success-500'
    case 'warning': return 'bg-warning-500'
    case 'danger': return 'bg-danger-500'
    case 'info': return 'bg-info-500'
    case 'accent': return 'bg-accent-500'
    case 'neutral':
    default: return 'bg-surface-500'
  }
})

const rootClasses = computed(() => [
  'inline-flex items-center font-medium whitespace-nowrap',
  props.pill ? 'rounded-full' : 'rounded',
  sizeClasses.value,
  variantToneClass.value,
])
</script>

<template>
  <span :class="rootClasses">
    <span
      v-if="dot"
      :class="['inline-block rounded-full', dotClass, size === 'md' ? 'h-2 w-2' : 'h-1.5 w-1.5']"
      aria-hidden="true"
    />
    <component v-if="icon" :is="icon" :size="iconSize" aria-hidden="true" />
    <span class="inline-flex items-center"><slot /></span>
    <button
      v-if="removable"
      type="button"
      class="ml-0.5 inline-flex items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10 -mr-0.5 cursor-pointer"
      :aria-label="'Удалить'"
      @click="emit('remove')"
    >
      <X :size="iconSize" />
    </button>
  </span>
</template>
