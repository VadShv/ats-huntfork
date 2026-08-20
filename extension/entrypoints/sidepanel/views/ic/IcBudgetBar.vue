<!--
  IcBudgetBar.vue — расчёт и индикация бюджета времени.
  ТЗ «Опросная карта» §3.2.

  Вступление 7 + компетенции × 17.5 + верификация 10 + завершение 5.
  За час реально 3 компетенции. Макс 4 — предупреждение при превышении.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useInterviewCard } from '../../composables/useInterviewCard'
import { useCountUp } from '../../fx/narrative'

const { card } = useInterviewCard()

const budget = computed(() => card.value?.budgetMinutes || 0)
const compCount = computed(() => card.value?.blocks.length || 0)
const isOver = computed(() => budget.value > 60)
const budgetCount = useCountUp(budget, { id: 'ic-budget', decimals: 0 })
const elapsedMin = computed(() => {
  const { elapsedSeconds } = useInterviewCard()
  return Math.floor(elapsedSeconds.value / 60)
})
</script>

<template>
  <div class="ic-budget" :class="{ 'ic-budget--over': isOver }">
    <span class="ic-budget__icon">⏱</span>
    <span class="ic-budget__time">
      <strong>{{ budget }}</strong> мин
      <span class="hf-sr">{{ budgetCount.finalDisplay.value }} мин</span>
      <span v-if="card?.mode === 'conduct'" class="ic-budget__elapsed">
        прошло {{ elapsedMin }}
      </span>
    </span>
    <span class="ic-budget__count">{{ compCount }} компет.</span>
    <span v-if="isOver" class="ic-budget__warn">превышен бюджет часа</span>
  </div>
</template>

<style scoped>
.ic-budget {
  display: flex;
  align-items: center;
  gap: var(--hf-s-2);
  padding: 2px var(--hf-s-2);
  border-radius: var(--hf-r-pill);
  background: var(--hf-surface-sunken);
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
}

.ic-budget__icon {
  font-size: 12px;
}

.ic-budget__time strong {
  color: var(--hf-fg);
  font-family: var(--hf-mono);
  font-variant-numeric: tabular-nums;
}

.ic-budget__elapsed {
  color: var(--hf-fg-subtle);
  margin-left: var(--hf-s-1);
}

.ic-budget__count {
  padding: 1px 6px;
  border-radius: var(--hf-r-pill);
  background: var(--hf-border);
  font-family: var(--hf-mono);
}

.ic-budget--over {
  background: var(--hf-match-low);
  color: var(--hf-fg-on-accent);
}

.ic-budget--over .ic-budget__time strong,
.ic-budget--over .ic-budget__count {
  color: var(--hf-fg-on-accent);
  background: transparent;
}

.ic-budget__warn {
  font-size: 10px;
}
</style>
