<script setup lang="ts">
import HfIcon from '../ui/HfIcon.vue'
import { useToast, type ToastTone } from '../composables/useToast'

const { toasts, dismiss } = useToast()

const iconFor = (tone: ToastTone) =>
  tone === 'success' ? 'check' : tone === 'error' ? 'close' : 'sparkle'
</script>

<template>
 <Teleport to="body">
    <div class="hf-toasts" role="region" aria-label="Уведомления" aria-live="polite">
     <TransitionGroup name="hf-toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="hf-toast"
          :class="`hf-toast--${t.tone}`"
          @click="dismiss(t.id)"
        >
          <span class="hf-toast-ico"><HfIcon :name="iconFor(t.tone)" :size="14" /></span>
          <span class="hf-toast-msg">{{ t.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script lang="ts">
export default { name: 'HfToaster' }
</script>

<style scoped>
.hf-toasts { max-width: 360px; margin: 0 auto; }
/* Базовый вид .hf-toast — в polish.css. Здесь только структура и тоны. */
.hf-toast { display: flex; align-items: center; gap: var(--hf-s-2); cursor: pointer; max-width: 320px; color: var(--hf-fg); border-radius: var(--hf-r-lg); }
.hf-toast--success { border-color: var(--hf-ok); }
.hf-toast--success .hf-toast-ico { color: var(--hf-ok); }
.hf-toast--error { border-color: var(--hf-err); }
.hf-toast--error .hf-toast-ico { color: var(--hf-err); }
.hf-toast-ico { display: flex; flex-shrink: 0; }
.hf-toast-msg { line-height: var(--hf-lh-normal); }

/* Transitions — в polish.css (.hf-toast-enter/leave-active). */
</style>
