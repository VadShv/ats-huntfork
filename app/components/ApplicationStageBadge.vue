<script setup lang="ts">
/**
 * ApplicationStageBadge
 * Displays a colored dot + stage name badge.
 * Renders a greyed "—" placeholder when name is empty.
 */
const props = withDefaults(defineProps<{
  name: string
  color: string
  size?: 'sm' | 'md'
}>(), {
  size: 'md',
})

const dotSize = computed(() =>
  props.size === 'sm' ? 'size-1.5' : 'size-2',
)

const textSize = computed(() =>
  props.size === 'sm' ? 'text-xs' : 'text-xs',
)

const paddingClass = computed(() =>
  props.size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-0.5',
)

/** Whether to show a real stage or the empty placeholder */
const isEmpty = computed(() => !props.name)
</script>

<template>
  <!-- Empty / no stage placeholder -->
  <span
    v-if="isEmpty"
    class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 text-surface-400 dark:text-surface-500 font-medium select-none"
    :class="[paddingClass, textSize]"
  >
    —
  </span>

  <!-- Stage badge with colored dot -->
  <span
    v-else
    class="inline-flex items-center gap-1.5 rounded-full bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 font-medium text-surface-700 dark:text-surface-200 select-none"
    :class="[paddingClass, textSize]"
  >
    <span
      class="rounded-full shrink-0"
      :class="dotSize"
      :style="{ backgroundColor: color }"
    />
    {{ name }}
  </span>
</template>
