<!--
  IcCoverageMatrix.vue — матрица покрытия индикаторов.
  ТЗ «Опросная карта» §7.3.

  Сетка: строки — индикаторы, столбцы — вопросы.
  Незакрытые индикаторы подсвечиваются --hf-match-low.
  При достижении 80% — отметка «оценка доступна».
-->
<script setup lang="ts">
import { computed } from 'vue'
import {
  COMPETENCY_CATALOG,
  type CompetencyBlock,
} from '../../composables/useInterviewCard'

const props = defineProps<{
  block: CompetencyBlock
}>()

const competency = computed(() =>
  COMPETENCY_CATALOG.find((c) => c.id === props.block.competencyId),
)

// Какой вопрос покрывает какой индикатор
const matrix = computed(() => {
  if (!competency.value) return []
  return competency.value.indicators.map((ind) => {
    const cells = props.block.questions.map((q) =>
      q.indicatorIds.includes(ind.num),
    )
    const isCovered = props.block.disclosedIndicators.has(ind.num) || cells.some((c, i) => c && props.block.questions[i].asked)
    return { ind, cells, isCovered }
  })
})

const coveragePct = computed(() => {
  if (!matrix.value.length) return 0
  const covered = matrix.value.filter((r) => r.isCovered).length
  return Math.round((covered / matrix.value.length) * 100)
})

const canRate = computed(() => coveragePct.value >= 80)
</script>

<template>
  <div class="ic-matrix">
    <div class="ic-matrix__head">
      <span class="ic-matrix__title">Покрытие индикаторов</span>
      <span class="ic-matrix__pct" :class="{ 'ic-matrix__pct--ok': canRate }">
        {{ coveragePct }}%
        <span v-if="canRate" class="ic-matrix__ok">оценка доступна</span>
      </span>
    </div>

    <div class="ic-matrix__grid">
      <!-- Заголовок: номера вопросов -->
      <div class="ic-matrix__corner"></div>
      <div
        v-for="(q, i) in block.questions"
        :key="q.id"
        class="ic-matrix__qhead"
        :title="q.text"
      >{{ i + 1 }}</div>

      <!-- Строки индикаторов -->
      <template v-for="row in matrix" :key="row.ind.num">
        <div class="ic-matrix__ind" :class="{ 'ic-matrix__ind--miss': !row.isCovered }">
          <span class="ic-matrix__ind-num">{{ row.ind.num }}</span>
          <span class="ic-matrix__ind-text">{{ row.ind.text }}</span>
        </div>
        <div
          v-for="(cell, ci) in row.cells"
          :key="ci"
          class="ic-matrix__cell"
          :class="{
            'ic-matrix__cell--hit': cell,
            'ic-matrix__cell--asked': cell && block.questions[ci].asked,
          }"
        >
          <span v-if="cell">●</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ic-matrix {
  padding: var(--hf-s-2);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface-sunken);
}

.ic-matrix__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--hf-s-2);
}

.ic-matrix__title {
  font-size: var(--hf-t-xs);
  font-weight: var(--hf-fw-semibold);
  color: var(--hf-fg);
}

.ic-matrix__pct {
  font-size: var(--hf-t-xs);
  font-family: var(--hf-mono);
  color: var(--hf-fg-muted);
  display: flex;
  align-items: center;
  gap: var(--hf-s-1);
  font-variant-numeric: tabular-nums;
}

.ic-matrix__pct--ok {
  color: var(--hf-match-high);
}

.ic-matrix__ok {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--hf-r-pill);
  background: var(--hf-match-high);
  color: var(--hf-fg-on-accent);
  font-family: var(--hf-font);
  animation: ic-matrix-pop 220ms var(--spring-bouncy);
}

@keyframes ic-matrix-pop {
  0% { transform: scale(0.8); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.ic-matrix__grid {
  display: grid;
  grid-template-columns: 1fr repeat(var(--q-count, 4), 24px);
  gap: 2px;
  font-size: 10px;
}

.ic-matrix__corner { }

.ic-matrix__qhead {
  text-align: center;
  font-family: var(--hf-mono);
  color: var(--hf-fg-subtle);
  font-size: 9px;
}

.ic-matrix__ind {
  display: flex;
  align-items: center;
  gap: var(--hf-s-1);
  padding: 2px 0;
  color: var(--hf-fg);
  overflow: hidden;
}

.ic-matrix__ind--miss {
  color: var(--hf-match-low);
}

.ic-matrix__ind-num {
  font-family: var(--hf-mono);
  font-weight: var(--hf-fw-bold);
  color: var(--hf-fg-muted);
  min-width: 14px;
}

.ic-matrix__ind--miss .ic-matrix__ind-num {
  color: var(--hf-match-low);
}

.ic-matrix__ind-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ic-matrix__cell {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  min-height: 18px;
  font-size: 9px;
}

.ic-matrix__cell--hit {
  background: var(--hf-border-subtle);
}

.ic-matrix__cell--asked {
  background: var(--hf-match-high);
  color: var(--hf-fg-on-accent);
  animation: ic-matrix-fill 220ms var(--hf-ease-out);
}

@keyframes ic-matrix-fill {
  0% { transform: scale(0.8); }
  100% { transform: scale(1); }
}
</style>
