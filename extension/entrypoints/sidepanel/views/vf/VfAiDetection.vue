<script setup lang="ts">
/** VfAiDetection — Блок В. Детекция ИИ-генерации.
 *  Шкала 0-100 с затемнённой зоной 30-70% «неинформативно».
 *  Двойная формулировка. Несворачиваемый дисклеймер. */
import { computed } from 'vue'
import HfIcon from '../../ui/HfIcon.vue'
import { useVerification } from '../../composables/useVerification'

const { aiDetection } = useVerification()

const BAND_LABEL: Record<string, string> = {
  low: 'низкая вероятность',
  uncertain: 'неинформативно',
  flagged: 'требует уточнения',
}

const markerLeft = computed(() => Math.max(0, Math.min(100, aiDetection.value.score)) + '%')
</script>

<template>
  <div class="vf-ai">
    <!-- Шкала -->
    <div class="vf-ai-scale">
      <div class="vf-ai-track">
        <div class="vf-ai-zone-low" />
        <div class="vf-ai-zone-uncertain" />
        <div class="vf-ai-zone-flag" />
        <div class="vf-ai-marker" :style="{ left: markerLeft }" />
      </div>
      <div class="vf-ai-ticks">
        <span>0%</span>
        <span class="vf-ai-tick-unc">неинформативно 30–70%</span>
        <span>100%</span>
      </div>
    </div>

    <div class="vf-ai-score">
      <span class="vf-ai-score-num">{{ aiDetection.score }}</span>
      <span class="vf-ai-score-band" :class="`vf-ai-score-band--${aiDetection.band}`">{{ BAND_LABEL[aiDetection.band] }}</span>
      <span v-if="aiDetection.flaggedSection" class="vf-ai-sec">{{ aiDetection.flaggedSection }}</span>
    </div>

    <!-- Двойная формулировка (обязательна) -->
    <p class="vf-ai-dual">{{ aiDetection.dualPhrase }}</p>

    <!-- Методы -->
    <div class="vf-ai-methods">
      <div v-for="m in aiDetection.methods" :key="m.name" class="vf-ai-method" :class="{ 'vf-ai-method--on': m.triggered }">
        <span class="vf-ai-method-dot" />
        <span>{{ m.name }}</span>
      </div>
    </div>

    <!-- Несворачиваемый дисклеймер -->
    <p class="vf-ai-disclaimer">
      <HfIcon name="alert" :size="12" />
      <span>{{ aiDetection.disclaimer }}</span>
    </p>
  </div>
</template>

<style scoped>
.vf-ai { display: flex; flex-direction: column; gap: var(--hf-s-3); }

.vf-ai-scale { display: flex; flex-direction: column; gap: 4px; }
.vf-ai-track { position: relative; height: 14px; border-radius: var(--hf-r-pill); overflow: hidden; display: flex; }
.vf-ai-zone-low { width: 30%; background: var(--hf-match-high-muted); }
.vf-ai-zone-uncertain { width: 40%; background: var(--hf-surface-sunken); opacity: 0.8; }
.vf-ai-zone-flag { width: 30%; background: var(--hf-match-mid-muted); }
.vf-ai-marker { position: absolute; top: -3px; bottom: -3px; width: 3px; background: var(--hf-fg); border-radius: var(--hf-r-pill); transform: translateX(-50%); box-shadow: var(--hf-shadow-sm); }
.vf-ai-ticks { display: flex; justify-content: space-between; font-size: 9px; color: var(--hf-fg-subtle); font-family: var(--hf-mono); }
.vf-ai-tick-unc { color: var(--hf-fg-muted); }

.vf-ai-score { display: flex; align-items: baseline; gap: var(--hf-s-2); }
.vf-ai-score-num { font-size: var(--hf-t-xl); font-weight: var(--hf-fw-bold); color: var(--hf-fg); font-family: var(--hf-mono); }
.vf-ai-score-band { font-size: var(--hf-t-xs); padding: 1px 7px; border-radius: var(--hf-r-pill); font-weight: var(--hf-fw-semibold); }
.vf-ai-score-band--low { background: var(--hf-match-high-muted); color: var(--hf-match-high); }
.vf-ai-score-band--uncertain { background: var(--hf-surface-sunken); color: var(--hf-fg-muted); }
.vf-ai-score-band--flagged { background: var(--hf-match-mid-muted); color: var(--hf-match-mid); }
.vf-ai-sec { margin-left: auto; font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }

.vf-ai-dual { margin: 0; font-size: var(--hf-t-sm); color: var(--hf-fg-muted); line-height: var(--hf-lh-normal); }

.vf-ai-methods { display: flex; flex-direction: column; gap: 2px; }
.vf-ai-method { display: flex; align-items: center; gap: var(--hf-s-2); font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.vf-ai-method-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--hf-border-strong); }
.vf-ai-method--on { color: var(--hf-match-mid); }
.vf-ai-method--on .vf-ai-method-dot { background: var(--hf-match-mid); }

/* Несворачиваемый — без transition/max-height, всегда виден */
.vf-ai-disclaimer { display: flex; align-items: flex-start; gap: var(--hf-s-1); margin: 0; padding: var(--hf-s-2) var(--hf-s-3); border-radius: var(--hf-r-md); background: var(--hf-surface-sunken); border: 1px solid var(--hf-border); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); line-height: var(--hf-lh-normal); }
.vf-ai-disclaimer :deep(svg) { flex-shrink: 0; margin-top: 1px; color: var(--hf-warn); }
</style>
