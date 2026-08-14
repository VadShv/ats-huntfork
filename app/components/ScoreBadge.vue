<script setup lang="ts">
/**
 * ScoreBadge — единый бейдж балла соответствия (0–100).
 * Формат: число + слово «балл(ов)» с правильной русской формой. Без знака «%».
 * Цвета:
 *   < 40  — красный
 *   40–69 — жёлтый
 *   ≥ 70  — зелёный
 * Пороги совпадают с ApplicationStageBadge/дизайн-системой Nexus.
 */
const props = withDefaults(defineProps<{
  score: number | null | undefined
  size?: 'xs' | 'sm' | 'md'
  showUnit?: boolean
}>(), {
  size: 'sm',
  showUnit: true,
})

const clamped = computed(() => {
  if (props.score == null || Number.isNaN(props.score as number)) return null
  return Math.max(0, Math.min(100, Math.round(props.score as number)))
})

const tone = computed(() => {
  const s = clamped.value
  if (s == null) return 'neutral'
  if (s < 40) return 'danger'
  if (s < 70) return 'warning'
  return 'success'
})

const paddingClass = computed(() => {
  if (props.size === 'xs') return 'px-1.5 py-0.5'
  if (props.size === 'sm') return 'px-2 py-0.5'
  return 'px-2.5 py-1'
})

const textSize = computed(() => (props.size === 'md' ? 'text-sm' : 'text-xs'))

const toneClass = computed(() => {
  switch (tone.value) {
    case 'danger':
      return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800'
    case 'warning':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'
    case 'success':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800'
    default:
      return 'bg-surface-100 text-surface-500 border-surface-200 dark:bg-surface-800 dark:text-surface-400 dark:border-surface-700'
  }
})

/** Русское склонение слова «балл» */
function plural(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'балл'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'балла'
  return 'баллов'
}

const label = computed(() => {
  const s = clamped.value
  if (s == null) return '—'
  return props.showUnit ? `${s} ${plural(s)}` : String(s)
})
</script>

<template>
  <span
    class="inline-flex items-center rounded-full border font-medium select-none tabular-nums"
    :class="[paddingClass, textSize, toneClass]"
    :aria-label="clamped != null ? `Балл соответствия ${clamped} из 100` : 'Балл соответствия не рассчитан'"
  >
    {{ label }}
  </span>
</template>
