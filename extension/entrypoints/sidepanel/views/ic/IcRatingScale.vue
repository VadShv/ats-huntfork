<!--
  IcRatingScale.vue — шкала оценки 1–5 с защитами.
  ТЗ «Опросная карта» §6.

  Блокировка до 80% покрытия + минимум 2 примера.
  Механика «весов»: позитивные/негативные на две чаши, итог — баланс.
  Защиты: независимый ввод, напоминание при 3-й «3» подряд.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useInterviewCard } from '../../composables/useInterviewCard'

const props = defineProps<{
  blockIdx: number
}>()

const {
  card,
  setRating,
  canRate,
  coverageRatio,
  consecutiveThrees,
} = useInterviewCard()

const block = computed(() => card.value?.blocks[props.blockIdx])
const competency = computed(() => {
  if (!block.value) return null
  return useInterviewCard().COMPETENCY_CATALOG.find((c) => c.id === block.value!.competencyId)
})

const isRateable = computed(() => block.value ? canRate(block.value) : false)
const coverage = computed(() => block.value ? coverageRatio(block.value) : 0)
const showMiddleReminder = computed(() => consecutiveThrees.value >= 3)

const RATING_LABELS: Record<number, string> = {
  5: 'Только позитивные, ролевая модель',
  4: 'Проявлена полностью, позитивных больше',
  3: 'Проявлена полностью, баланс',
  2: 'Базовые проявления, негативные преобладают',
  1: 'Не проявлена',
}

function rate(n: number) {
  if (!isRateable.value) return
  setRating(props.blockIdx, n)
}
</script>

<template>
  <div class="ic-rating">
    <!-- Определение компетенции всегда на экране (защита от смешения) -->
    <div v-if="competency" class="ic-rating__def">
      <strong>{{ competency.name }}.</strong> {{ competency.definition }}
    </div>

    <!-- Механика весов: позитивные vs негативные -->
    <div v-if="block" class="ic-rating__scales">
      <div class="ic-rating__pan ic-rating__pan--pos">
        <span class="ic-rating__pan-lbl">Позитивные</span>
        <span class="ic-rating__pan-count">{{ block.questions.filter(q => q.polarity === 'positive' && q.asked).length }}</span>
      </div>
      <div class="ic-rating__balance">
        <span class="ic-rating__balance-bar" :style="{ '--bal': (block.questions.filter(q => q.polarity === 'positive' && q.asked).length / Math.max(1, block.questions.filter(q => q.asked).length)) * 100 + '%' }" />
      </div>
      <div class="ic-rating__pan ic-rating__pan--neg">
        <span class="ic-rating__pan-lbl">Негативные</span>
        <span class="ic-rating__pan-count">{{ block.questions.filter(q => q.polarity === 'negative' && q.asked).length }}</span>
      </div>
    </div>

    <!-- Шкала 1–5 -->
    <div class="ic-rating__scale" :class="{ 'is-locked': !isRateable }">
      <button
        v-for="n in 5"
        :key="n"
        class="ic-rating__btn"
        :class="{ 'is-active': block?.rating === n }"
        :disabled="!isRateable"
        :aria-label="`Оценка ${n}: ${RATING_LABELS[n]}`"
        @click="rate(n)"
      >{{ n }}</button>
    </div>

    <!-- Блокировка / подпись -->
    <div v-if="!isRateable" class="ic-rating__locked">
      Недостаточно данных ({{ Math.round(coverage * 100) }}% индикаторов, нужно 80%)
    </div>
    <div v-else-if="block?.rating" class="ic-rating__label">
      {{ RATING_LABELS[block.rating] }}
    </div>

    <!-- Защита: тяга к середине -->
    <Transition name="hf-grid">
      <div v-if="showMiddleReminder" class="ic-rating__warn">
        Три оценки «3» подряд. Уверены, что это не тяга к середине?
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ic-rating {
  display: flex;
  flex-direction: column;
  gap: var(--hf-s-2);
  padding: var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface);
}

.ic-rating__def {
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
  line-height: 1.4;
}

.ic-rating__def strong {
  color: var(--hf-fg);
}

.ic-rating__scales {
  display: grid;
  grid-template-columns: 1fr 40px 1fr;
  gap: var(--hf-s-2);
  align-items: center;
}

.ic-rating__pan {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--hf-s-1);
  border-radius: var(--hf-r-sm);
}

.ic-rating__pan--pos {
  background: var(--hf-match-high);
  color: var(--hf-fg-on-accent);
}

.ic-rating__pan--neg {
  background: var(--hf-match-low);
  color: var(--hf-fg-on-accent);
}

.ic-rating__pan-lbl {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.ic-rating__pan-count {
  font-size: var(--hf-t-lg);
  font-weight: var(--hf-fw-bold);
  font-family: var(--hf-mono);
}

.ic-rating__balance {
  height: 4px;
  border-radius: var(--hf-r-pill);
  background: var(--hf-border);
  position: relative;
  overflow: hidden;
}

.ic-rating__balance-bar {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: var(--hf-r-pill);
  background: var(--hf-fg-muted);
  width: var(--bal, 50%);
  transition: width var(--hf-dur-base) var(--hf-ease-out);
}

.ic-rating__scale {
  display: flex;
  gap: var(--hf-s-1);
}

.ic-rating__btn {
  flex: 1;
  height: 36px;
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface-sunken);
  font-size: var(--hf-t-md);
  font-weight: var(--hf-fw-bold);
  color: var(--hf-fg-muted);
  cursor: pointer;
  transition: all var(--hf-dur-instant) var(--hf-ease-out);
}

.ic-rating__btn:hover:not(:disabled) {
  border-color: var(--hf-primary);
  color: var(--hf-primary);
}

.ic-rating__btn.is-active {
  background: var(--hf-primary);
  border-color: var(--hf-primary);
  color: var(--hf-fg-on-accent);
}

.ic-rating__scale.is-locked .ic-rating__btn {
  opacity: 0.4;
  cursor: not-allowed;
}

.ic-rating__locked {
  font-size: var(--hf-t-xs);
  color: var(--hf-match-low);
  text-align: center;
}

.ic-rating__label {
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
  text-align: center;
}

.ic-rating__warn {
  padding: var(--hf-s-2);
  border-radius: var(--hf-r-sm);
  background: var(--hf-match-mid);
  color: var(--hf-fg-on-accent);
  font-size: var(--hf-t-xs);
  text-align: center;
}
</style>
