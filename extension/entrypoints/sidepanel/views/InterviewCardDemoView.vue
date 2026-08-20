<!--
  InterviewCardView.vue — модуль «Опросная карта интервьюера» (CARE).
  ТЗ «Опросная карта интервьюера (CARE)» v1.0.

  Два режима:
   - prep: полный документ с редактированием, матрица покрытия, оценочные листы.
   - conduct: один вопрос крупно, чекбоксы CARE, поле записи в фокусе, клавиатура.

  CARE = Content – Action – Role – Effect. R = Role (НЕ Result).
-->
<script setup lang="ts">
import PrototypeBadge from '../ui/PrototypeBadge.vue'
import { computed, ref, onMounted, onScopeDispose } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfButton from '../ui/HfButton.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import TypedQuestion from './vf/TypedQuestion.vue'
import IcCareBadge from './ic/IcCareBadge.vue'
import IcCoverageMatrix from './ic/IcCoverageMatrix.vue'
import IcRatingScale from './ic/IcRatingScale.vue'
import IcBudgetBar from './ic/IcBudgetBar.vue'
import { useViewMorph } from '../fx/narrative'
import {
  useInterviewCard,
  COMPETENCY_CATALOG,
} from '../composables/useInterviewCard'
import { useVerification } from '../composables/useVerification'
import { useSidekick } from '../composables/useSidekick'
import { useToast } from '../composables/useToast'

const {
  card,
  cardMode,
  activeBlockIdx,
  activeQuestionIdx,
  hasCard,
  buildCard,
  setMode,
  markAsked,
  setNotes,
  markIndicator,
  nextQuestion,
  prevQuestion,
  coverageRatio,
  canRate,
  hasBiasWarning,
  exportCard,
  clearCard,
} = useInterviewCard()

const { allRedFlags } = useVerification()
const { parsedFull, jobs, selectedJobId } = useSidekick()
const { toast } = useToast()

const { morph: icMorph } = useViewMorph()

const vacancyTitle = computed(() =>
  jobs.value.find((j) => j.id === selectedJobId.value)?.title || '',
)

const expandedBlock = ref<number | null>(0)
const expandedListen = ref<string | null>(null)

function onBuild() {
  icMorph(() => {
    buildCard(
      parsedFull.value,
      vacancyTitle.value,
      allRedFlags.value,
      [],
    )
  })
  toast('Карта интервью построена', 'success')
}

function toggleMode() {
  icMorph(() => setMode(cardMode.value === 'prep' ? 'conduct' : 'prep'))
}

// ── Conduct-режим: клавиатура ──
const currentBlock = computed(() => card.value?.blocks[activeBlockIdx.value])
const currentQuestion = computed(() => currentBlock.value?.questions[activeQuestionIdx.value])
const currentCompetency = computed(() =>
  currentBlock.value ? COMPETENCY_CATALOG.find((c) => c.id === currentBlock.value!.competencyId) : null,
)

function onKeydown(e: KeyboardEvent) {
  if (cardMode.value !== 'conduct' || !card.value) return
  if (e.key === 'ArrowRight') { e.preventDefault(); nextQuestion() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); prevQuestion() }
  else if (e.key === ' ') {
    e.preventDefault()
    if (currentQuestion.value) {
      markAsked(activeBlockIdx.value, currentQuestion.value.id)
    }
  }
  else if (e.key === 'm' || e.key === 'M' || e.key === 'ь') {
    if (currentQuestion.value?.indicatorIds.length) {
      markIndicator(activeBlockIdx.value, currentQuestion.value.indicatorIds[0])
    }
  }
  else if (e.key === 'Escape') { e.preventDefault(); setMode('prep') }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onScopeDispose(() => {
  window.removeEventListener('keydown', onKeydown)
})

function onExport() {
  const text = exportCard()
  navigator.clipboard?.writeText(text).then(() => {
    toast('Карта скопирована', 'success')
  })
}

const elapsedMin = computed(() => {
  const { elapsedSeconds } = useInterviewCard()
  return Math.floor(elapsedSeconds.value / 60)
})
</script>

<template>
  <div class="ic-view hf-scroll" aria-live="polite">
    <div style="padding: var(--hf-s-3) var(--hf-s-4) 0;"><PrototypeBadge /></div>
    <!-- Шапка -->
    <div class="ic-header hf-sticky hf-glass">
      <div class="ic-header-main">
        <span class="ic-header-title">Опросная карта</span>
        <IcBudgetBar v-if="hasCard" />
      </div>
      <div class="ic-header-actions" v-if="hasCard">
        <HfButton variant="subtle" size="sm" @click="toggleMode">
          {{ cardMode === 'prep' ? 'Проведение' : 'Подготовка' }}
        </HfButton>
        <HfButton variant="subtle" size="sm" @click="onExport">
          <HfIcon name="copy" :size="12" /> Экспорт
        </HfButton>
      </div>
    </div>

    <!-- Пустое состояние -->
    <HfEmpty
      v-if="!hasCard"
      icon="help"
      title="Опросная карта не построена"
      subtitle="Карта строится из резюме, вакансии и рисков верификации. Сгенерируйте карту для подготовки к интервью по компетенциям (CARE)."
    >
      <HfButton size="sm" @click="onBuild">Построить карту</HfButton>
    </HfEmpty>

    <!-- Неполнота входов -->
    <div v-if="hasCard && card!.completeness === 'partial'" class="ic-partial">
      <HfIcon name="alert" :size="12" />
      Карта неполная. Не хватает: {{ card!.missingInputs.join(', ') }}
    </div>

    <!-- Предупреждение о смещении -->
    <div v-if="hasCard && hasBiasWarning()" class="ic-bias">
      <HfIcon name="alert" :size="12" />
      Ваша статистика оценок показывает систематическое смещение. Оценивайте независимо.
    </div>

    <!-- ════ РЕЖИМ ПОДГОТОВКИ ════ -->
    <div v-if="hasCard && cardMode === 'prep'" class="ic-prep">
      <div
        v-for="(block, bi) in card!.blocks"
        :key="block.competencyId"
        class="ic-block"
      >
        <button
          class="ic-block__head"
          :class="{ 'is-open': expandedBlock === bi }"
          @click="expandedBlock = expandedBlock === bi ? null : bi"
          :aria-expanded="expandedBlock === bi"
        >
          <span class="ic-block__num">{{ bi + 1 }}</span>
          <span class="ic-block__name">
            {{ COMPETENCY_CATALOG.find(c => c.id === block.competencyId)?.name }}
          </span>
          <span class="ic-block__meta">
            {{ block.questions.length }} вопросов ·
            {{ Math.round(coverageRatio(block) * 100) }}%
          </span>
          <HfIcon
            name="chevron-down"
            :size="14"
            :class="{ 'ic-block__chev--open': expandedBlock === bi }"
          />
        </button>

        <Transition name="hf-grid">
          <div v-if="expandedBlock === bi" class="ic-block__body">
            <!-- Определение всегда на экране -->
            <p class="ic-block__def">
              {{ COMPETENCY_CATALOG.find(c => c.id === block.competencyId)?.definition }}
            </p>

            <!-- Вопросы -->
            <div class="ic-questions">
              <div
                v-for="(q, qi) in block.questions"
                :key="q.id"
                class="ic-q"
                :class="{ 'ic-q--probe': q.isProbe }"
              >
                <div class="ic-q__head">
                  <span class="ic-q__level">
                    {{ q.level === 1 ? 'Запрос примера' : q.level === 2 ? `CARE ${q.careStage}` : 'Зонд' }}
                  </span>
                  <IcCareBadge v-if="q.careStage" :stage="q.careStage" />
                  <span v-if="q.isProbe" class="ic-q__probe-tag">зонд</span>
                  <span v-if="q.polarity === 'negative'" class="ic-q__neg">негативный кейс</span>
                </div>

                <p class="ic-q__text">{{ q.text }}</p>

                <!-- Что слушать -->
                <button
                  class="ic-q__listen-toggle"
                  @click="expandedListen = expandedListen === q.id ? null : q.id"
                  :aria-expanded="expandedListen === q.id"
                >
                  <HfIcon name="chevron-down" :size="11" :class="{ 'ic-q__chev--open': expandedListen === q.id }" />
                  Что слушать в ответе
                </button>
                <Transition name="hf-grid">
                  <p v-if="expandedListen === q.id" class="ic-q__listen-body">{{ q.listenFor }}</p>
                </Transition>

                <!-- Индикаторы -->
                <div class="ic-q__inds">
                  <span class="ic-q__inds-lbl">Индикаторы:</span>
                  <span
                    v-for="indNum in q.indicatorIds"
                    :key="indNum"
                    class="ic-q__ind"
                  >{{ indNum }}</span>
                </div>
              </div>
            </div>

            <!-- Матрица покрытия -->
            <IcCoverageMatrix :block="block" />

            <!-- Оценочный лист -->
            <IcRatingScale :block-idx="bi" />
          </div>
        </Transition>
      </div>
    </div>

    <!-- ════ РЕЖИМ ПРОВЕДЕНИЯ ════ -->
    <div v-if="hasCard && cardMode === 'conduct' && currentQuestion" class="ic-conduct">
      <!-- Прогресс -->
      <div class="ic-conduct__progress">
        <span>{{ activeBlockIdx + 1 }}/{{ card!.blocks.length }} компет.</span>
        <span>{{ activeQuestionIdx + 1 }}/{{ currentBlock!.questions.length }} вопр.</span>
        <span>{{ elapsedMin }} мин</span>
      </div>

      <!-- Определение компетенции -->
      <div v-if="currentCompetency" class="ic-conduct__comp">
        <strong>{{ currentCompetency.name }}</strong>
      </div>

      <!-- Вопрос крупно + печатная машинка -->
      <div class="ic-conduct__question">
        <div class="ic-conduct__qhead">
          <span class="ic-q__level">
            {{ currentQuestion.level === 1 ? 'Запрос примера' : currentQuestion.level === 2 ? `CARE ${currentQuestion.careStage}` : 'Зонд' }}
          </span>
          <IcCareBadge v-if="currentQuestion.careStage" :stage="currentQuestion.careStage" />
        </div>
        <TypedQuestion :id="currentQuestion.id" :text="currentQuestion.text" />
      </div>

      <!-- Что слушать (свернуто) -->
      <details class="ic-conduct__listen">
        <summary>Что слушать в ответе</summary>
        <p>{{ currentQuestion.listenFor }}</p>
      </details>

      <!-- Поле записи (всегда в фокусе, автосохранение) -->
      <textarea
        class="ic-conduct__notes"
        :value="currentQuestion.notes"
        placeholder="Записывайте ответ сюда..."
        @input="setNotes(activeBlockIdx, currentQuestion.id, ($event.target as HTMLTextAreaElement).value)"
        ref="notesRef"
      ></textarea>

      <!-- Чекбоксы: отметить вопрос -->
      <div class="ic-conduct__actions">
        <button
          class="ic-conduct__mark"
          :class="{ 'is-marked': currentQuestion.asked }"
          @click="markAsked(activeBlockIdx, currentQuestion.id)"
          :aria-label="currentQuestion.asked ? 'Снять отметку «задано»' : 'Отметить вопрос заданным'"
        >
          <HfIcon :name="currentQuestion.asked ? 'check' : 'circle'" :size="14" />
          {{ currentQuestion.asked ? 'Задано' : 'Отметить заданным' }}
        </button>
        <button
          class="ic-conduct__mark"
          @click="currentQuestion.indicatorIds.forEach(n => markIndicator(activeBlockIdx, n))"
          aria-label="Пометить все индикаторы текущего вопроса"
        >
          <HfIcon name="target" :size="14" /> Пометить индикатор
        </button>
      </div>

      <!-- Навигация -->
      <div class="ic-conduct__nav">
        <HfButton variant="subtle" size="sm" @click="prevQuestion">← Назад</HfButton>
        <HfButton variant="subtle" size="sm" @click="nextQuestion">Далее →</HfButton>
      </div>

      <!-- Подсказка по хоткеям -->
      <div class="ic-conduct__hints">
        <span>←/→ навигация</span>
        <span>Space — отметить</span>
        <span>M — индикатор</span>
        <span>Esc — выход</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ic-view {
  height: 100%;
  overflow-y: auto;
  padding: var(--hf-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--hf-s-3);
}

.ic-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-s-2);
  padding: var(--hf-s-2) 0;
  background: var(--hf-surface);
  z-index: 10;
}

.ic-header-main {
  display: flex;
  align-items: center;
  gap: var(--hf-s-3);
}

.ic-header-title {
  font-size: var(--hf-t-lg);
  font-weight: var(--hf-fw-semibold);
  color: var(--hf-fg);
}

.ic-header-actions {
  display: flex;
  gap: var(--hf-s-1);
}

.ic-partial, .ic-bias {
  display: flex;
  align-items: center;
  gap: var(--hf-s-2);
  padding: var(--hf-s-2) var(--hf-s-3);
  border-radius: var(--hf-r-md);
  background: var(--hf-match-mid);
  color: var(--hf-fg-on-accent);
  font-size: var(--hf-t-xs);
}

.ic-bias {
  background: var(--hf-match-low);
}

/* ── Режим подготовки ── */
.ic-prep {
  display: flex;
  flex-direction: column;
  gap: var(--hf-s-2);
}

.ic-block {
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface);
  overflow: hidden;
}

.ic-block__head {
  display: flex;
  align-items: center;
  gap: var(--hf-s-2);
  width: 100%;
  padding: var(--hf-s-3);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
}

.ic-block__num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--hf-r-pill);
  background: var(--hf-primary-muted);
  color: var(--hf-primary);
  font-size: 11px;
  font-weight: var(--hf-fw-bold);
  flex-shrink: 0;
}

.ic-block__name {
  font-size: var(--hf-t-sm);
  font-weight: var(--hf-fw-semibold);
  color: var(--hf-fg);
}

.ic-block__meta {
  margin-left: auto;
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
  font-family: var(--hf-mono);
  font-variant-numeric: tabular-nums;
}

.ic-block__body {
  padding: 0 var(--hf-s-3) var(--hf-s-3);
  display: flex;
  flex-direction: column;
  gap: var(--hf-s-2);
}

.ic-block__def {
  margin: 0;
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
  line-height: 1.4;
  padding: var(--hf-s-2);
  background: var(--hf-surface-sunken);
  border-radius: var(--hf-r-sm);
}

.ic-questions {
  display: flex;
  flex-direction: column;
  gap: var(--hf-s-2);
}

.ic-q {
  padding: var(--hf-s-2);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface);
}

.ic-q--probe {
  border-color: var(--hf-match-mid);
  background: var(--hf-primary-muted);
}

.ic-q__head {
  display: flex;
  align-items: center;
  gap: var(--hf-s-1);
  margin-bottom: var(--hf-s-1);
}

.ic-q__level {
  font-size: 10px;
  font-weight: var(--hf-fw-semibold);
  color: var(--hf-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.ic-q__probe-tag {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: var(--hf-r-pill);
  background: var(--hf-match-mid);
  color: var(--hf-fg-on-accent);
}

.ic-q__neg {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: var(--hf-r-pill);
  background: var(--hf-match-low);
  color: var(--hf-fg-on-accent);
}

.ic-q__text {
  margin: 0 0 var(--hf-s-1);
  font-size: var(--hf-t-sm);
  line-height: 1.5;
  color: var(--hf-fg);
}

.ic-q__listen-toggle {
  display: flex;
  align-items: center;
  gap: var(--hf-s-1);
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.ic-q__listen-body {
  margin: var(--hf-s-1) 0 0;
  padding: var(--hf-s-2);
  background: var(--hf-surface-sunken);
  border-radius: var(--hf-r-sm);
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
  line-height: 1.4;
  white-space: pre-line;
}

.ic-q__inds {
  display: flex;
  align-items: center;
  gap: var(--hf-s-1);
  margin-top: var(--hf-s-1);
  font-size: 10px;
  color: var(--hf-fg-subtle);
}

.ic-q__ind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  border-radius: 3px;
  background: var(--hf-border);
  font-family: var(--hf-mono);
  font-weight: var(--hf-fw-bold);
  color: var(--hf-fg);
}

/* ── Режим проведения ── */
.ic-conduct {
  display: flex;
  flex-direction: column;
  gap: var(--hf-s-3);
}

.ic-conduct__progress {
  display: flex;
  gap: var(--hf-s-3);
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
  font-family: var(--hf-mono);
  font-variant-numeric: tabular-nums;
}

.ic-conduct__comp strong {
  font-size: var(--hf-t-md);
  color: var(--hf-fg);
}

.ic-conduct__question {
  padding: var(--hf-s-3);
}

.ic-conduct__qhead {
  display: flex;
  align-items: center;
  gap: var(--hf-s-2);
  margin-bottom: var(--hf-s-2);
}

.ic-conduct__listen {
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
}

.ic-conduct__listen summary {
  cursor: pointer;
  padding: var(--hf-s-1) 0;
}

.ic-conduct__listen p {
  margin: var(--hf-s-1) 0 0;
  padding: var(--hf-s-2);
  background: var(--hf-surface-sunken);
  border-radius: var(--hf-r-sm);
  line-height: 1.4;
  white-space: pre-line;
}

.ic-conduct__notes {
  width: 100%;
  min-height: 80px;
  padding: var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface);
  font-size: var(--hf-t-sm);
  line-height: 1.5;
  color: var(--hf-fg);
  resize: vertical;
  outline: none;
}

.ic-conduct__notes:focus {
  border-color: var(--hf-primary);
}

.ic-conduct__actions {
  display: flex;
  gap: var(--hf-s-2);
}

.ic-conduct__mark {
  display: flex;
  align-items: center;
  gap: var(--hf-s-1);
  padding: var(--hf-s-2) var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface);
  font-size: var(--hf-t-xs);
  color: var(--hf-fg);
  cursor: pointer;
}

.ic-conduct__mark.is-marked {
  border-color: var(--hf-match-high);
  color: var(--hf-match-high);
}

.ic-conduct__nav {
  display: flex;
  justify-content: space-between;
}

.ic-conduct__hints {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-s-2);
  font-size: 10px;
  color: var(--hf-fg-subtle);
  font-family: var(--hf-mono);
}

/* Transition для раскрытия */
:deep(.hf-grid-enter-active),
:deep(.hf-grid-leave-active) {
  transition: grid-template-rows var(--hf-dur-base) var(--spring-gentle),
              opacity var(--hf-dur-fast) var(--hf-ease-out);
}
</style>
