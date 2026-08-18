<script setup lang="ts">
/**
 * OnboardingHint — компактная подсказка для пустых состояний.
 * Показывает что делать дальше, с иконкой и коротким текстом.
 */
import HfIcon from './HfIcon.vue'

defineProps<{
  icon?: string
  title: string
  text?: string
  hint?: string
}>()
</script>

<template>
  <div class="onboarding-hint">
    <div v-if="icon" class="onboarding-hint__icon">
      <HfIcon :name="icon" :size="24" />
    </div>
    <div class="onboarding-hint__body">
      <p class="onboarding-hint__title">{{ title }}</p>
      <p v-if="text" class="onboarding-hint__text">{{ text }}</p>
      <p v-if="hint" class="onboarding-hint__hint">
        <HfIcon name="sparkle" :size="12" />
        {{ hint }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.onboarding-hint {
  display: flex;
  gap: var(--hf-s-3);
  padding: var(--hf-s-3);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface-raised);
  border: 1px solid var(--hf-border-subtle, var(--hf-border));
  animation: hf-card-in var(--hf-dur-base) var(--hf-ease-out) both;
}

:global(.dark) .onboarding-hint {
  background: var(--hf-surface-raised);
}

.onboarding-hint__icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--hf-r-md);
  background: var(--hf-surface-sunken);
  color: var(--hf-accent);
}

:global(.dark) .onboarding-hint__icon {
  background: var(--hf-surface-sunken);
}

.onboarding-hint__body {
  flex: 1;
  min-width: 0;
}

.onboarding-hint__title {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--hf-fg);
}

.onboarding-hint__text {
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--hf-fg-muted);
}

.onboarding-hint__hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: 11px;
  color: var(--hf-accent);
  font-weight: 500;
}

@media (prefers-reduced-motion: reduce) {
  .onboarding-hint { animation: none; }
}
</style>
