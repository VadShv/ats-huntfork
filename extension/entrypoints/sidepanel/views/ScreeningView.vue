<script setup lang="ts">
/**
 * Скрининг: оценка соответствия вакансии (mode='fit') и верификация данных.
 * Два подраздела: «Оценка» (fit/summary, стриминг) и «Верификация» (модуль Stage 6).
 * Обёртка над phase==='summary'. Стриминг, pulse-orb, скелетон с задержкой 180 мс.
 */
import { ref, watch, computed } from 'vue'
import HfButton from '../ui/HfButton.vue'
import HfIcon from '../ui/HfIcon.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import { useSidekick, useSidekickActions } from '../composables/useSidekick'
import VerificationView from './VerificationView.vue'
import InterviewCardView from './InterviewCardView.vue'

const {
  phase, aiMode, aiModeLabel, aiText, aiRunning, aiError, aiUsage, aiCached,
  aiJobId, jobs, copied, noteSaving, noteSaved, noteCandidateId, aiHtml,
} = useSidekick()
const {
  runSummary, rerunFit, abortAi, copyAi, saveAsNote, addToBase, openChat, loadJobsOnce,
} = useSidekickActions()

/** Скелетон показываем только после 180 мс — чтобы не мигал при быстром ответе. */
const showSkeleton = ref(false)
let skTimer: ReturnType<typeof setTimeout> | null = null

watch(aiRunning, (running) => {
  if (skTimer) { clearTimeout(skTimer); skTimer = null }
  showSkeleton.value = false
  if (running && !aiText.value) {
    skTimer = setTimeout(() => { showSkeleton.value = true }, 180)
  }
}, { immediate: true })

// Подгружаем вакансии, когда раздел активен и ещё пуст
watch(phase, (p) => {
  if (p === 'summary' && aiMode.value === 'fit' && !jobs.value.length) loadJobsOnce()
}, { immediate: true })

/** Пустое состояние: запуск оценки соответствия. */
const isFitEmpty = computed(() =>
  aiMode.value === 'fit' && !aiText.value && !aiRunning.value && !aiError.value && !aiJobId.value)

/** Внутренний подраздел Скрининга: «Оценка» (по умолчанию) или «Верификация». */
const screeningTab = ref<'fit' | 'verify' | 'interview'>('fit')
</script>

<template>
  <div class="screening-view hf-scroll">
   <!-- Подраздел: Оценка / Верификация -->
    <div class="hf-subtabs" role="tablist">
      <button class="hf-subtab" :class="{ 'hf-subtab--active': screeningTab === 'fit' }" role="tab" :aria-selected="screeningTab === 'fit'" @click="screeningTab = 'fit'">
        <HfIcon name="sparkle" :size="14" /> Оценка
      </button>
      <button class="hf-subtab" :class="{ 'hf-subtab--active': screeningTab === 'verify' }" role="tab" :aria-selected="screeningTab === 'verify'" @click="screeningTab = 'verify'">
        <HfIcon name="radar" :size="14" /> Верификация
      </button>
      <button class="hf-subtab" :class="{ 'hf-subtab--active': screeningTab === 'interview' }" role="tab" :aria-selected="screeningTab === 'interview'" @click="screeningTab = 'interview'">
        <HfIcon name="help" :size="14" /> Интервью
      </button>
    </div>

    <VerificationView v-if="screeningTab === 'verify'" />
    <InterviewCardView v-else-if="screeningTab === 'interview'" />
    <template v-else>
      <!-- Заголовок режима -->
      <div class="scr-head">
        <span class="scr-orb" :class="{ 'scr-orb--live': aiRunning }"><HfIcon name="sparkle" :size="16" /></span>
        <span class="scr-mode">{{ aiModeLabel }}</span>
        <button v-if="aiRunning" class="scr-stop" title="Остановить" @click="abortAi">
          <HfIcon name="stop" :size="14" /> Стоп
        </button>
      </div>

      <!-- Оценка соответствия: выбор вакансии -->
      <div v-if="aiMode === 'fit'" class="scr-job">
        <label class="hf-field-label">Вакансия</label>
        <select v-model="aiJobId" class="hf-input" :disabled="aiRunning" @change="rerunFit">
          <option value="">— Выберите вакансию —</option>
          <option v-for="j in jobs" :key="j.id" :value="j.id">
            {{ j.title }}{{ j.status !== 'open' ? ` (${j.status})` : '' }}
          </option>
        </select>
        <p v-if="!aiJobId && !aiText" class="hf-hint">Выберите вакансию — оценка соответствия запустится автоматически.</p>
      </div>

      <!-- Пусто (fit без вакансии) -->
      <HfEmpty
        v-if="isFitEmpty"
        icon="screening"
        title="Оценка соответствия"
        subtitle="Выберите вакансию выше — панель оценит, насколько кандидат подходит, и даст рекомендации."
      />

      <!-- Loading: скелетон (только после 180 мс) -->
      <div v-else-if="aiRunning && !aiText" class="scr-loading">
        <div v-if="showSkeleton" class="scr-skel">
          <HfSkeleton :lines="4" width="55%" />
          <HfSkeleton :lines="3" width="40%" />
        </div>
        <div v-else class="scr-thinking">
          <span class="hf-pulse-orb scr-pulse" />
          <span>Читаем страницу и готовим ответ…</span>
        </div>
      </div>

      <!-- Streaming / Done -->
      <div v-else-if="aiText" class="scr-result">
        <div class="md" :class="{ 'md--streaming': aiRunning }" v-html="aiHtml" />
        <span v-if="aiRunning" class="hf-caret" />

        <!-- Метрики -->
        <div v-if="aiUsage && !aiRunning" class="scr-usage">
          {{ aiCached ? 'результат из кэша' : `токены: ${aiUsage.promptTokens ?? '?'} + ${aiUsage.completionTokens ?? '?'}` }}
        </div>

        <!-- Действия -->
        <div v-if="!aiRunning" class="scr-actions hf-actions-in">
          <HfButton variant="subtle" size="sm" @click="copyAi">
            <HfIcon :name="copied ? 'check' : 'copy'" :size="14" /> {{ copied ? 'Скопировано' : 'Копировать' }}
          </HfButton>
          <HfButton
            v-if="noteCandidateId"
            variant="subtle" size="sm"
            :disabled="noteSaving || noteSaved"
            @click="saveAsNote"
          >
            <HfIcon name="note" :size="14" />
            {{ noteSaved ? 'В заметках' : (noteSaving ? 'Сохраняем…' : 'В заметки') }}
          </HfButton>
          <HfButton
            v-if="aiMode !== 'fragment' && !noteCandidateId"
            variant="primary" size="sm"
            @click="addToBase"
          >
            <HfIcon name="import" :size="14" /> В Huntfork
          </HfButton>
        </div>

        <div class="scr-foot">
          <HfButton variant="ghost" size="sm" :disabled="aiRunning" @click="openChat">
            <HfIcon name="chat" :size="14" /> Задать вопрос
          </HfButton>
          <HfButton variant="ghost" size="sm" :disabled="aiRunning" @click="runSummary('summary', { label: 'Сводка' })">
            <HfIcon name="refresh" :size="14" /> Сводка
          </HfButton>
        </div>
      </div>

      <!-- Ошибка -->
      <div v-else-if="aiError" class="scr-error hf-shake">
        <HfIcon name="refresh" :size="20" />
        <p>{{ aiError }}</p>
        <HfButton variant="ghost" size="sm" @click="runSummary(aiMode, { label: aiModeLabel })">Повторить</HfButton>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
export default { name: 'ScreeningView' }
</script>

<style scoped>
.screening-view { height: 100%; overflow-y: auto; padding: var(--hf-s-4); display: flex; flex-direction: column; gap: var(--hf-s-4); }

.scr-head { display: flex; align-items: center; gap: var(--hf-s-2); }
.scr-orb {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: var(--hf-r-pill);
  background: var(--hf-primary-muted); color: var(--hf-primary);
}
.scr-orb--live { background: var(--hf-primary); color: var(--hf-fg-on-accent); }
.scr-mode { font-size: var(--hf-t-md); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); flex: 1; }
.scr-stop {
  display: flex; align-items: center; gap: var(--hf-s-1);
  padding: var(--hf-s-1) var(--hf-s-2); border-radius: var(--hf-r-sm);
  background: var(--hf-err-muted); color: var(--hf-err);
  font-size: var(--hf-t-xs); font-weight: var(--hf-fw-medium);
}

.scr-job { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.hf-field-label { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-fg-muted); }
.hf-hint { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }

.scr-loading { padding: var(--hf-s-6) 0; }
.scr-thinking { display: flex; align-items: center; gap: var(--hf-s-3); color: var(--hf-fg-muted); font-size: var(--hf-t-sm); }
.scr-pulse { width: 12px; height: 12px; border-radius: var(--hf-r-pill); background: var(--hf-primary); }
.scr-skel { display: flex; flex-direction: column; gap: var(--hf-s-4); }

.scr-result { display: flex; flex-direction: column; gap: var(--hf-s-3); }
.md--streaming { min-height: 60px; }
.scr-usage { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.scr-actions { display: flex; flex-wrap: wrap; gap: var(--hf-s-2); }
.scr-foot { display: flex; gap: var(--hf-s-2); margin-top: var(--hf-s-2); }

.scr-error { display: flex; flex-direction: column; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-6); text-align: center; color: var(--hf-err); }
</style>
