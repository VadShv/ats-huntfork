<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'primary' | 'ghost' | 'subtle' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  block?: boolean
}>(), { variant: 'ghost', size: 'md', disabled: false, block: false })
</script>

<template>
  <button
    class="hf-btn"
    :class="[`hf-btn--${variant}`, `hf-btn--${size}`, { 'hf-btn--block': block }]"
    :disabled="disabled"
    v-ripple
  >
    <slot />
  </button>
</template>
