<script setup lang="ts">
/**
 * UiCard — карточка-контейнер Huntfork UI.
 *
 * Слоты:
 *  - header — заголовок/тулбар (опц.)
 *  - default — основной контент
 *  - footer — низ карточки (опц.)
 *
 * Варианты:
 *  - default   — стандартная карточка (border + bg)
 *  - elevated  — без рамки, c тенью
 *  - outlined  — только рамка, без фона
 *  - dashed    — пунктирная рамка (для empty-state)
 *  - tinted    — закрашенный фон (для предупреждений и т.п.) через `tone`
 *
 * Tone (для tinted/outlined): brand | warning | danger | success | info
 *
 * Radii: 'lg' (16px ≈ rounded-xl) — основной; 'md' (12px ≈ rounded-lg) — компактный.
 *
 * Внешне совпадает с существующими `rounded-xl border border-surface-200 bg-white p-5`.
 */
import { computed } from 'vue'

type CardVariant = 'default' | 'elevated' | 'outlined' | 'dashed' | 'tinted'
type CardTone = 'neutral' | 'brand' | 'warning' | 'danger' | 'success' | 'info'
type CardPadding = 'none' | 'sm' | 'md' | 'lg'
type CardRadius = 'md' | 'lg'

interface Props {
  variant?: CardVariant
  tone?: CardTone
  padding?: CardPadding
  radius?: CardRadius
  /** Кликабельная карточка — добавляет hover-эффекты */
  interactive?: boolean
  /** Тег корневого элемента */
  as?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  tone: 'neutral',
  padding: 'md',
  radius: 'lg',
  interactive: false,
  as: 'div',
})

const radiusClass = computed(() => (props.radius === 'md' ? 'rounded-lg' : 'rounded-xl'))

const paddingClass = computed(() => {
  switch (props.padding) {
    case 'none': return ''
    case 'sm': return 'p-3'
    case 'lg': return 'p-6'
    case 'md':
    default: return 'p-5'
  }
})

const toneBgClass = computed(() => {
  switch (props.tone) {
    case 'brand': return 'bg-brand-50 dark:bg-brand-950'
    case 'warning': return 'bg-warning-50 dark:bg-warning-950'
    case 'danger': return 'bg-danger-50 dark:bg-danger-950'
    case 'success': return 'bg-success-50 dark:bg-success-950'
    case 'info': return 'bg-info-50 dark:bg-info-950'
    case 'neutral':
    default: return 'bg-white dark:bg-surface-900'
  }
})

const toneBorderClass = computed(() => {
  switch (props.tone) {
    case 'brand': return 'border-brand-200 dark:border-brand-900'
    case 'warning': return 'border-warning-200 dark:border-warning-900/50'
    case 'danger': return 'border-danger-200 dark:border-danger-900'
    case 'success': return 'border-success-200 dark:border-success-900'
    case 'info': return 'border-info-200 dark:border-info-900'
    case 'neutral':
    default: return 'border-surface-200 dark:border-surface-800'
  }
})

const variantClasses = computed(() => {
  switch (props.variant) {
    case 'elevated':
      return [toneBgClass.value, 'shadow-md border border-transparent']
    case 'outlined':
      return ['bg-transparent border', toneBorderClass.value]
    case 'dashed':
      return [toneBgClass.value, 'border border-dashed', toneBorderClass.value]
    case 'tinted':
      return [toneBgClass.value, 'border', toneBorderClass.value]
    case 'default':
    default:
      return [toneBgClass.value, 'border', toneBorderClass.value]
  }
})

const interactiveClasses = computed(() =>
  props.interactive
    ? 'transition-all hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700 cursor-pointer'
    : '',
)

const rootClasses = computed(() => [
  radiusClass.value,
  ...variantClasses.value,
  interactiveClasses.value,
])

defineSlots<{
  header?: () => any
  default?: () => any
  footer?: () => any
}>()
</script>

<template>
  <component :is="as" :class="rootClasses">
    <header
      v-if="$slots.header"
      class="px-5 py-4 border-b border-surface-200 dark:border-surface-800"
    >
      <slot name="header" />
    </header>

    <div :class="$slots.header || $slots.footer ? paddingClass : paddingClass">
      <slot />
    </div>

    <footer
      v-if="$slots.footer"
      class="px-5 py-3 border-t border-surface-200 dark:border-surface-800 bg-surface-50/50 dark:bg-surface-950/50"
      :class="radius === 'md' ? 'rounded-b-lg' : 'rounded-b-xl'"
    >
      <slot name="footer" />
    </footer>
  </component>
</template>
