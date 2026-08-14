<script setup lang="ts">
/**
 * SourceBadge — единый бейдж источника отклика.
 * Использует getApplicationSourceMeta из useApplicationSource (общий источник истины).
 * Форма: иконка + читаемый label. В `size="xs"` — только иконка с тултипом.
 */
import { getApplicationSourceMeta, type ApplicationSource } from '~/composables/useApplicationSource'

const props = withDefaults(defineProps<{
  source: ApplicationSource | string | null | undefined
  size?: 'xs' | 'sm' | 'md'
  iconOnly?: boolean
}>(), {
  size: 'sm',
  iconOnly: false,
})

const meta = computed(() => getApplicationSourceMeta((props.source ?? 'other') as ApplicationSource))

const iconSize = computed(() => (props.size === 'md' ? 'size-4' : 'size-3.5'))
const textSize = computed(() => (props.size === 'md' ? 'text-sm' : 'text-xs'))
const paddingClass = computed(() => {
  if (props.iconOnly) return 'p-1'
  if (props.size === 'md') return 'px-2.5 py-1 gap-1.5'
  return 'px-2 py-0.5 gap-1.5'
})
</script>

<template>
  <span
    class="inline-flex items-center rounded-full border font-medium select-none"
    :class="[paddingClass, textSize, meta.badgeClass]"
    :title="meta.tooltip"
    :aria-label="meta.tooltip"
  >
    <component :is="meta.icon" :class="[iconSize, meta.iconClass, 'shrink-0']" />
    <span v-if="!iconOnly">{{ meta.label }}</span>
  </span>
</template>
