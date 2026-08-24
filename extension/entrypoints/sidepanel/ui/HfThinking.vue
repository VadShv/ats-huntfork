<script setup lang="ts">
/**
 * П3: сворачиваемый блок «размышлений» reasoning-модели.
 * Пока идёт thinking-фаза — развёрнут и стримит приглушённый текст,
 * с приходом первого видимого токена автоматически сворачивается в «Думал N с».
 */
import { nextTick, ref, watch } from 'vue'
import HfIcon from './HfIcon.vue'

const props = defineProps<{
  /** Накопленный текст размышлений */
  text: string
  /** true, пока thinking-фаза активна (ответ ещё не начался) */
  live: boolean
  /** Длительность размышлений, мс (из телеметрии done-события) */
  ms?: number | null
}>()

const open = ref(false)
const bodyEl = ref<HTMLElement | null>(null)

// Разворачиваемся при старте thinking, сворачиваемся при первом тексте ответа
watch(() => props.live, (v) => { open.value = v }, { immediate: true })

// Автопрокрутка стрима мыслей вниз
watch(() => props.text, async () => {
  if (!props.live || !open.value) return
  await nextTick()
  const el = bodyEl.value
  if (el) el.scrollTop = el.scrollHeight
})

function label(): string {
  if (props.live) return 'Размышляет…'
  if (props.ms && props.ms > 500) return `Думал ${Math.max(1, Math.round(props.ms / 1000))} с`
  return 'Размышления'
}
</script>

<template>
  <div v-if="text" class="hf-think" :class="{ 'hf-think--live': live }">
    <button type="button" class="hf-think-head" @click="open = !open">
      <span class="hf-think-orb" :class="{ 'hf-think-orb--live': live }">
        <HfIcon name="sparkle" :size="12" />
      </span>
      <span class="hf-think-label">{{ label() }}</span>
      <HfIcon name="chevron-down" :size="12" class="hf-think-chev" :class="{ 'hf-think-chev--open': open }" />
    </button>
    <div v-show="open" ref="bodyEl" class="hf-think-body">{{ text }}</div>
  </div>
</template>

<style scoped>
.hf-think {
  margin-bottom: var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: 8px;
  background: var(--hf-surface-sunken);
  overflow: hidden;
}
.hf-think-head {
  display: flex;
  align-items: center;
  gap: var(--hf-s-2);
  width: 100%;
  padding: var(--hf-s-2) var(--hf-s-3);
  background: none;
  border: 0;
  cursor: pointer;
  color: var(--hf-fg-muted);
  font-size: var(--hf-t-sm);
  text-align: left;
}
.hf-think-head:hover { color: var(--hf-fg); }
.hf-think-orb { display: inline-flex; color: var(--hf-fg-faint); }
.hf-think-orb--live { animation: hf-think-pulse 1.4s ease-in-out infinite; }
@keyframes hf-think-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
.hf-think-label { flex: 1; }
.hf-think-chev { transition: transform 0.15s ease; }
.hf-think-chev--open { transform: rotate(180deg); }
.hf-think-body {
  max-height: 160px;
  overflow-y: auto;
  padding: 0 var(--hf-s-3) var(--hf-s-3);
  color: var(--hf-fg-subtle);
  font-size: var(--hf-t-sm);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
@media (prefers-reduced-motion: reduce) {
  .hf-think-orb--live { animation: none; }
  .hf-think-chev { transition: none; }
}
</style>
