<script setup lang="ts">
/** Форма создания/правки вопроса банка (в UiDrawer). Спринт 1. */
import type { BankQuestion, BankQuestionType, InterviewStage, QuestionComplexity } from '~/composables/useBankQuestions'
import type { AssessmentTopic } from '~/composables/useAssessmentTopics'

const props = defineProps<{
  modelValue: Partial<BankQuestion>
  topics: AssessmentTopic[]
  readonly?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Partial<BankQuestion>] }>()

function patch<K extends keyof BankQuestion>(key: K, value: BankQuestion[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

const typeOptions: { label: string, value: BankQuestionType }[] = [
  { label: 'Поведенческий', value: 'behavioral' },
  { label: 'Ситуационный', value: 'situational' },
  { label: 'Мотивационный', value: 'motivational' },
  { label: 'Фактический', value: 'factual' },
  { label: 'Верификация', value: 'verification' },
  { label: 'Рефлексивный', value: 'reflective' },
  { label: 'Профессиональный', value: 'professional' },
  { label: 'Контрольный', value: 'control' },
  { label: 'ИИ-персональный', value: 'ai_personal' },
]
const stageOptions: { label: string, value: InterviewStage }[] = [
  { label: 'Скрининг', value: 'screening' },
  { label: 'Рекрутёр', value: 'recruiter' },
  { label: 'Нанимающий менеджер', value: 'hiring_manager' },
  { label: 'Финал', value: 'final' },
  { label: 'Эксперт', value: 'expert' },
  { label: 'Полный цикл', value: 'full_cycle' },
]
const complexityOptions: { label: string, value: QuestionComplexity }[] = [
  { label: 'Низкая', value: 'low' },
  { label: 'Средняя', value: 'medium' },
  { label: 'Высокая', value: 'high' },
]
const topicOptions = computed(() => props.topics
  .filter(t => t.status === 'active')
  .map(t => ({ label: t.name, value: t.id })))

// Клиентская эвристика качества (мгновенная подсказка).
const localWarnings = computed(() => {
  const out: { code: string, message: string }[] = []
  const text = (props.modelValue.text ?? '').trim().toLowerCase()
  const closed = ['есть ли', 'был ли', 'умеете ли', 'знаете ли', 'можете ли', 'готовы ли']
  if (closed.some(s => text.startsWith(s))) out.push({ code: 'closed', message: 'Вопрос выглядит закрытым (да/нет). Переформулируйте как открытый.' })
  if ((props.modelValue.text ?? '').length > 300) out.push({ code: 'long', message: 'Более 300 символов — может быть тяжёл для восприятия.' })
  if (!props.modelValue.goal) out.push({ code: 'no_goal', message: 'Не заполнена цель — потребуется для публикации.' })
  if (!props.modelValue.expectedSignal) out.push({ code: 'no_signal', message: 'Не указан признак сильного ответа.' })
  return out
})
</script>

<template>
  <div class="space-y-4">
    <UiSelect
      :model-value="modelValue.primaryTopicId ?? null"
      label="Тема оценки"
      required
      :options="topicOptions"
      placeholder="Выберите тему"
      :disabled="readonly"
      @update:model-value="v => patch('primaryTopicId', String(v))"
    />

    <UiTextarea
      :model-value="modelValue.text ?? ''"
      label="Формулировка вопроса"
      required
      :rows="3"
      autosize
      :maxlength="600"
      show-count
      placeholder="Расскажите о самой сложной сделке, которую вы закрыли лично…"
      :readonly="readonly"
      @update:model-value="v => patch('text', v)"
    />

    <div class="grid grid-cols-2 gap-3">
      <UiSelect
        :model-value="modelValue.type ?? 'behavioral'"
        label="Тип"
        :options="typeOptions"
        :disabled="readonly"
        @update:model-value="v => patch('type', v as BankQuestionType)"
      />
      <UiSelect
        :model-value="modelValue.recommendedStage ?? null"
        label="Рекомендуемый этап"
        :options="stageOptions"
        clearable
        placeholder="Не указан"
        :disabled="readonly"
        @update:model-value="v => patch('recommendedStage', (v as InterviewStage) ?? null)"
      />
    </div>

    <UiTextarea
      :model-value="modelValue.goal ?? ''"
      label="Цель вопроса"
      :rows="2"
      autosize
      placeholder="Что именно выясняем этим вопросом"
      :readonly="readonly"
      @update:model-value="v => patch('goal', v)"
    />

    <UiTextarea
      :model-value="modelValue.expectedSignal ?? ''"
      label="Признак сильного ответа"
      :rows="2"
      autosize
      placeholder="Что считаем убедительным ответом"
      :readonly="readonly"
      @update:model-value="v => patch('expectedSignal', v)"
    />

    <div class="grid grid-cols-2 gap-3">
      <QuestionBankStringListEditor
        :model-value="modelValue.strongIndicators ?? []"
        label="Зелёные флаги"
        placeholder="Индикатор сильного ответа"
        @update:model-value="v => patch('strongIndicators', v)"
      />
      <QuestionBankStringListEditor
        :model-value="modelValue.weakIndicators ?? []"
        label="Красные флаги"
        placeholder="Индикатор слабого ответа"
        @update:model-value="v => patch('weakIndicators', v)"
      />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <UiSelect
        :model-value="modelValue.complexity ?? null"
        label="Сложность"
        :options="complexityOptions"
        clearable
        placeholder="Не указана"
        :disabled="readonly"
        @update:model-value="v => patch('complexity', (v as QuestionComplexity) ?? null)"
      />
      <UiInput
        :model-value="modelValue.durationMin ?? undefined"
        type="number"
        label="Время, мин"
        placeholder="напр. 5"
        :readonly="readonly"
        @update:model-value="v => patch('durationMin', v === '' ? null : Number(v))"
      />
    </div>

    <QuestionBankQualityWarnings v-if="!readonly" :warnings="localWarnings" />
  </div>
</template>
