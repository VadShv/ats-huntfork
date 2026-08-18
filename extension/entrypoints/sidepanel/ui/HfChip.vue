<script setup lang="ts">
defineProps<{ tone?: 'default' | 'primary' | 'high' | 'mid' | 'low' }>()
</script>

<template>
  <span class="hf-chip" :class="tone ? `hf-chip--${tone}` : ''">
    <slot />
  </span>
</template>
