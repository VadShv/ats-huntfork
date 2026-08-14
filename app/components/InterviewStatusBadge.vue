<script setup lang="ts">
/**
 * InterviewStatusBadge — статус интервью.
 * Отдельный доменный компонент с той же геометрией и правилами, что StatusBadge.
 */
type InterviewStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'no_show'
  | 'cancelled'
  | 'rescheduled'
  | string

const props = withDefaults(defineProps<{
  status: InterviewStatus | null | undefined
  size?: 'xs' | 'sm' | 'md'
}>(), {
  size: 'sm',
})

const CONFIG: Record<string, { label: string, badgeClass: string, dotClass: string }> = {
  scheduled: {
    label: 'Запланировано',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    dotClass: 'bg-blue-500',
  },
  in_progress: {
    label: 'Идёт',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    dotClass: 'bg-amber-500',
  },
  completed: {
    label: 'Завершено',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
    dotClass: 'bg-emerald-500',
  },
  no_show: {
    label: 'Не явился',
    badgeClass: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
    dotClass: 'bg-red-500',
  },
  cancelled: {
    label: 'Отменено',
    badgeClass: 'bg-surface-100 text-surface-600 border-surface-200 dark:bg-surface-800 dark:text-surface-400 dark:border-surface-700',
    dotClass: 'bg-surface-400',
  },
  rescheduled: {
    label: 'Перенесено',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
    dotClass: 'bg-purple-500',
  },
}

const meta = computed(() => CONFIG[String(props.status ?? '')] ?? {
  label: String(props.status ?? '—'),
  badgeClass: 'bg-surface-100 text-surface-600 border-surface-200 dark:bg-surface-800 dark:text-surface-400 dark:border-surface-700',
  dotClass: 'bg-surface-400',
})

const paddingClass = computed(() => {
  if (props.size === 'xs') return 'px-1.5 py-0.5 gap-1'
  if (props.size === 'sm') return 'px-2 py-0.5 gap-1.5'
  return 'px-2.5 py-1 gap-1.5'
})
const textSize = computed(() => (props.size === 'md' ? 'text-sm' : 'text-xs'))
const dotSize = computed(() => (props.size === 'md' ? 'size-2' : 'size-1.5'))
</script>

<template>
  <span
    class="inline-flex items-center rounded-full border font-medium select-none"
    :class="[paddingClass, textSize, meta.badgeClass]"
    :aria-label="`Статус интервью: ${meta.label}`"
  >
    <span class="rounded-full shrink-0" :class="[dotSize, meta.dotClass]" />
    {{ meta.label }}
  </span>
</template>
