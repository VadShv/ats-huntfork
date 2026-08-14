<script setup lang="ts">
/**
 * StatusBadge — единый бейдж legacy-статуса отклика.
 * Использовать только когда нет стадии (правило: стадия — первичный индикатор).
 * Форма: pill с цветной точкой и подписью.
 */
import { getApplicationStatusMeta, type ApplicationStatus } from '~/composables/useApplicationStatus'

const props = withDefaults(defineProps<{
  status: ApplicationStatus | null | undefined
  size?: 'xs' | 'sm' | 'md'
}>(), {
  size: 'sm',
})

const meta = computed(() => getApplicationStatusMeta(props.status))

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
    :aria-label="`Статус: ${meta.label}`"
  >
    <span class="rounded-full shrink-0" :class="[dotSize, meta.dotClass]" />
    {{ meta.label }}
  </span>
</template>
