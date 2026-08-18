<script setup lang="ts">
import HfButton from './HfButton.vue'
defineProps<{
  icon?: string
  title: string
  subtitle?: string
  actionLabel?: string
}>()
const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <div class="hf-empty hf-empty-in">
    <svg class="hf-empty-ill" width="64" height="64" viewBox="0 0 64 64" fill="none"
      stroke="var(--hf-fg-subtle)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <template v-if="icon === 'chat'">
        <path d="M50 30a16 16 0 0 1-19 15.7L16 50l4.3-13.7A16 16 0 1 1 50 30z" />
        <path d="M24 30h16M24 36h10" opacity="0.5" />
      </template>
      <template v-else-if="icon === 'sourcing'">
        <circle cx="26" cy="24" r="10" /><path d="M52 52l-12-12" />
        <path d="M14 52v-4a8 8 0 0 1 8-8h8" />
      </template>
      <template v-else-if="icon === 'screening'">
        <path d="M32 56s18-9 18-22V18l-18-7-18 7v16c0 13 18 22 18 22z" />
        <path d="M24 32l6 6 10-10" />
      </template>
      <template v-else-if="icon === 'outreach'">
        <rect x="10" y="18" width="44" height="30" rx="3" />
        <path d="M10 22l22 14 22-14" />
      </template>
      <template v-else-if="icon === 'pipeline'">
        <rect x="8" y="12" width="12" height="40" rx="2" />
        <rect x="26" y="12" width="12" height="28" rx="2" />
        <rect x="44" y="12" width="12" height="20" rx="2" />
      </template>
      <template v-else-if="icon === 'library'">
        <path d="M48 54l-16-11-16 11V16a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4z" />
      </template>
      <template v-else>
        <rect x="14" y="14" width="36" height="36" rx="6" />
      </template>
    </svg>
    <div class="hf-empty__title">{{ title }}</div>
    <p v-if="subtitle" class="hf-empty__text">{{ subtitle }}</p>
    <HfButton v-if="actionLabel" variant="primary" size="sm" @click="emit('action')">
      {{ actionLabel }}
    </HfButton>
    <slot />
  </div>
</template>

<style scoped>
/* Базовая раскладка .hf-empty и иллюстрации — в polish.css.
   scoped переопределения убраны во избежание конфликта имён. */
.hf-empty-ill { margin-bottom: var(--hf-s-2); }
.hf-empty__title { font-weight: var(--hf-fw-semibold); }
</style>
