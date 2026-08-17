<script setup lang="ts">
/** SmPlan — блок «Приоритетная последовательность» (блок 6.3).
 *  Вертикальный таймлайн с чекбоксами. План на первые 3 дня. */
import HfIcon from '../../ui/HfIcon.vue'
import { useSearchMap } from '../../composables/useSearchMap'

const { plan, toggleStep, doneSteps } = useSearchMap()
</script>

<template>
  <div class="sm-plan">
    <div class="sm-plan-progress">
      <div class="sm-plan-progress-bar"><div class="sm-plan-progress-fill" :style="{ width: (doneSteps / plan.length * 100) + '%' }" /></div>
      <span class="sm-plan-progress-text">{{ doneSteps }} / {{ plan.length }}</span>
    </div>

    <ol class="sm-plan-timeline">
      <li
        v-for="(step, i) in plan"
        :key="step.id"
        class="sm-plan-step"
        :class="{ 'sm-plan-step--done': step.done }"
        :style="{ '--hf-i': Math.min(i, 7) }"
      >
        <div class="sm-plan-rail">
          <button class="sm-plan-check" :class="{ 'sm-plan-check--on': step.done }" @click="toggleStep(step.id)">
            <HfIcon v-if="step.done" name="check" :size="12" />
          </button>
          <span v-if="i < plan.length - 1" class="sm-plan-line" />
        </div>
        <div class="sm-plan-content">
          <div class="sm-plan-step-head">
            <span class="sm-plan-day">День {{ step.day }}</span>
            <span class="sm-plan-title">{{ step.title }}</span>
          </div>
          <p class="sm-plan-detail">{{ step.detail }}</p>
          <div v-if="step.branchIfEmpty" class="sm-plan-branch">
            <HfIcon name="route" :size="12" />
            <span>{{ step.branchIfEmpty }}</span>
          </div>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.sm-plan { }
.sm-plan-progress { display: flex; align-items: center; gap: var(--hf-s-2); margin-bottom: var(--hf-s-4); }
.sm-plan-progress-bar { flex: 1; height: 6px; border-radius: var(--hf-r-pill); background: var(--hf-surface-sunken); overflow: hidden; }
.sm-plan-progress-fill { height: 100%; background: var(--hf-match-high); border-radius: var(--hf-r-pill); transition: width var(--spring-gentle-dur) var(--spring-gentle); }
.sm-plan-progress-text { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); font-family: var(--hf-mono); }

.sm-plan-timeline { list-style: none; margin: 0; padding: 0; }
.sm-plan-step { display: flex; gap: var(--hf-s-3); padding-bottom: var(--hf-s-4); opacity: 0; animation: hf-card-cascade var(--hf-dur-base) var(--hf-ease-out) forwards; animation-delay: calc(var(--hf-i, 0) * 40ms); }
.sm-plan-step:last-child { padding-bottom: 0; }
.sm-plan-rail { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
.sm-plan-check { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--hf-border-strong); background: var(--hf-surface); color: transparent; transition: all var(--hf-dur-fast) var(--hf-ease-spring); flex-shrink: 0; }
.sm-plan-check--on { border-color: var(--hf-match-high); background: var(--hf-match-high); color: var(--hf-fg-on-accent); }
.sm-plan-line { flex: 1; width: 2px; min-height: 20px; background: var(--hf-border); margin-top: 2px; }
.sm-plan-step--done .sm-plan-line { background: var(--hf-match-high); }

.sm-plan-content { flex: 1; min-width: 0; padding-bottom: var(--hf-s-1); }
.sm-plan-step-head { display: flex; align-items: baseline; gap: var(--hf-s-2); margin-bottom: 2px; flex-wrap: wrap; }
.sm-plan-day { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-primary); }
.sm-plan-title { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-medium); color: var(--hf-fg); }
.sm-plan-step--done .sm-plan-title { color: var(--hf-fg-muted); text-decoration: line-through; }
.sm-plan-detail { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); margin: 0; line-height: var(--hf-lh-normal); }
.sm-plan-branch { display: flex; align-items: flex-start; gap: 4px; margin-top: var(--hf-s-2); padding: var(--hf-s-1) var(--hf-s-2); border-radius: var(--hf-r-sm); background: var(--hf-warn-muted); font-size: var(--hf-t-xs); color: var(--hf-warn); line-height: var(--hf-lh-normal); }
.sm-plan-branch svg { margin-top: 2px; flex-shrink: 0; }
@media (prefers-reduced-motion: reduce) { .sm-plan-step { animation: none !important; } }
</style>
