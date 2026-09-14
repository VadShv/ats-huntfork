<script setup lang="ts">
/** Форма темы оценки (в UiDrawer). Спринт 1. */
import type { AssessmentTopic, AssessmentTopicType } from '~/composables/useAssessmentTopics'

const props = defineProps<{ modelValue: Partial<AssessmentTopic> }>()
const emit = defineEmits<{ 'update:modelValue': [value: Partial<AssessmentTopic>] }>()

function patch<K extends keyof AssessmentTopic>(key: K, value: AssessmentTopic[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

const typeOptions: { label: string, value: AssessmentTopicType }[] = [
  { label: 'Ценность', value: 'value' },
  { label: 'Soft skill', value: 'soft_skill' },
  { label: 'Менеджмент', value: 'management' },
  { label: 'Профессиональная', value: 'professional' },
  { label: 'Мотивация', value: 'motivation' },
  { label: 'Ожидания', value: 'expectations' },
  { label: 'Фактчекинг', value: 'factcheck' },
  { label: 'Шкала достижений', value: 'achievement_scale' },
  { label: 'Логика карьеры', value: 'career_logic' },
  { label: 'Зона риска', value: 'risk_zone' },
  { label: 'Культура', value: 'culture' },
  { label: 'Произвольная', value: 'custom' },
]
</script>

<template>
  <div class="space-y-4">
    <UiInput
      :model-value="modelValue.name ?? ''"
      label="Название темы"
      required
      placeholder="напр. Ориентация на результат"
      @update:model-value="v => patch('name', String(v))"
    />
    <div class="grid grid-cols-2 gap-3">
      <UiInput
        :model-value="modelValue.shortName ?? ''"
        label="Короткое имя"
        placeholder="для бейджей"
        @update:model-value="v => patch('shortName', String(v))"
      />
      <UiSelect
        :model-value="modelValue.type ?? 'custom'"
        label="Тип темы"
        :options="typeOptions"
        @update:model-value="v => patch('type', v as AssessmentTopicType)"
      />
    </div>
    <UiTextarea
      :model-value="modelValue.definition ?? ''"
      label="Определение"
      :rows="2"
      autosize
      placeholder="Что понимаем под этой темой"
      @update:model-value="v => patch('definition', v)"
    />
    <UiTextarea
      :model-value="modelValue.goal ?? ''"
      label="Цель оценки"
      :rows="2"
      autosize
      placeholder="Что именно выясняем"
      @update:model-value="v => patch('goal', v)"
    />
    <div class="grid grid-cols-2 gap-3">
      <QuestionBankStringListEditor
        :model-value="modelValue.positiveIndicators ?? []"
        label="Позитивные индикаторы"
        placeholder="Признак проявления"
        @update:model-value="v => patch('positiveIndicators', v)"
      />
      <QuestionBankStringListEditor
        :model-value="modelValue.negativeIndicators ?? []"
        label="Негативные индикаторы"
        placeholder="Признак отсутствия"
        @update:model-value="v => patch('negativeIndicators', v)"
      />
    </div>
  </div>
</template>
