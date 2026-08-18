<script setup lang="ts">
/** VfVerifiability — Блок Г. Верифицируемость контактов.
 *  Индекс 0-100, 4 градации, чек-лист источников. Низкий индекс — не ред-флаг. */
import { computed } from 'vue'
import HfIcon from '../../ui/HfIcon.vue'
import { useVerification } from '../../composables/useVerification'

const { verifiability } = useVerification()

const TIER_LABEL: Record<string, string> = {
  high: 'Высокая', mid: 'Средняя', low: 'Низкая', minimal: 'Минимальная',
}
const TIER_DESC: Record<string, string> = {
  high: 'Обильный след, легко проверить',
  mid: 'Основное проверяемо',
  low: 'Мало точек проверки',
  minimal: 'Практически непроверяем',
}

const ringDash = computed(() => {
  const v = verifiability.value.value
  const r = 15.9155
  const circ = 2 * Math.PI * r
  return { dash: (v / 100) * circ, circ }
})
</script>

<template>
  <div class="vf-vb">
    <div class="vf-vb-top">
      <!-- Кольцо индекса -->
      <div class="vf-vb-ring">
        <svg viewBox="0 0 36 36" class="vf-vb-svg">
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--hf-surface-sunken)" stroke-width="3" />
          <circle
            cx="18" cy="18" r="15.9155" fill="none"
            :stroke="`var(--hf-match-${verifiability.tier === 'high' ? 'high' : verifiability.tier === 'mid' ? 'mid' : 'low'})`"
            stroke-width="3" stroke-linecap="round"
            :stroke-dasharray="`${ringDash.dash} ${ringDash.circ}`"
            transform="rotate(-90 18 18)"
          />
        </svg>
        <div class="vf-vb-ring-val">
          <span class="vf-vb-ring-num hf-num">{{ verifiability.value }}</span>
          <span class="vf-vb-ring-of">/100</span>
        </div>
      </div>
      <div class="vf-vb-grade">
        <span class="vf-vb-tier" :class="`vf-vb-tier--${verifiability.tier}`">{{ TIER_LABEL[verifiability.tier] }}</span>
        <span class="vf-vb-desc">{{ TIER_DESC[verifiability.tier] }}</span>
      </div>
    </div>

    <!-- Чек-лист источников -->
    <div class="vf-vb-sources">
      <div v-for="s in verifiability.sources" :key="s.kind" class="vf-vb-src" :class="{ 'vf-vb-src--no': !s.present }">
        <HfIcon :name="s.present ? 'check' : 'close'" :size="12" />
        <span class="vf-vb-src-label">{{ s.label }}</span>
        <span class="vf-vb-src-note">{{ s.note }}</span>
      </div>
    </div>

    <!-- Заметка: низкий индекс — не ред-флаг -->
    <p class="vf-vb-note">
      <HfIcon name="alert" :size="12" />
      <span>{{ verifiability.note }}</span>
    </p>
  </div>
</template>

<style scoped>
.vf-vb { display: flex; flex-direction: column; gap: var(--hf-s-3); }

.vf-vb-top { display: flex; align-items: center; gap: var(--hf-s-3); }
.vf-vb-ring { position: relative; width: 56px; height: 56px; flex-shrink: 0; }
.vf-vb-svg { width: 100%; height: 100%; }
.vf-vb-ring-val { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.vf-vb-ring-num { font-size: var(--hf-t-md); font-weight: var(--hf-fw-bold); color: var(--hf-fg); font-family: var(--hf-mono); }
.vf-vb-ring-of { font-size: 8px; color: var(--hf-fg-subtle); }

.vf-vb-grade { display: flex; flex-direction: column; gap: 1px; }
.vf-vb-tier { font-size: var(--hf-t-md); font-weight: var(--hf-fw-semibold); }
.vf-vb-tier--high { color: var(--hf-match-high); }
.vf-vb-tier--mid { color: var(--hf-match-mid); }
.vf-vb-tier--low, .vf-vb-tier--minimal { color: var(--hf-match-low); }
.vf-vb-desc { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }

.vf-vb-sources { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
.vf-vb-src { display: flex; align-items: center; gap: var(--hf-s-1); padding: var(--hf-s-1) var(--hf-s-2); font-size: var(--hf-t-xs); color: var(--hf-fg); }
.vf-vb-src :deep(svg) { color: var(--hf-match-high); flex-shrink: 0; }
.vf-vb-src--no :deep(svg) { color: var(--hf-fg-subtle); }
.vf-vb-src--no { color: var(--hf-fg-subtle); }
.vf-vb-src-label { font-weight: var(--hf-fw-medium); }
.vf-vb-src-note { color: var(--hf-fg-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.vf-vb-note { display: flex; align-items: flex-start; gap: var(--hf-s-1); margin: 0; padding: var(--hf-s-2) var(--hf-s-3); border-radius: var(--hf-r-md); background: var(--hf-info-muted); font-size: var(--hf-t-xs); color: var(--hf-info); line-height: var(--hf-lh-normal); }
.vf-vb-note :deep(svg) { flex-shrink: 0; margin-top: 1px; }
</style>
