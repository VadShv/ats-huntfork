<script setup lang="ts">
/** Редактор BARS-якорей шкалы (Спринт 1). */
import { Plus, Trash2, AlertTriangle } from 'lucide-vue-next'
import type { BarsAnchor } from '~/composables/useAssessmentTopics'

const props = defineProps<{ modelValue: BarsAnchor[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: BarsAnchor[]] }>()

const EVALUATIVE = ['отличн', 'прекрасн', 'слаб', 'сильн', 'хорош', 'плох', 'великолепн', 'ужасн', 'блестящ', 'посредствен']

function update(i: number, key: keyof BarsAnchor, value: unknown) {
  const next = props.modelValue.map((a, idx) => (idx === i ? { ...a, [key]: value } : a))
  emit('update:modelValue', next)
}
function addRow() {
  emit('update:modelValue', [...props.modelValue, {
    value: '', anchorText: '', positiveExamples: [], negativeExamples: [], displayOrder: props.modelValue.length,
  }])
}
function removeRow(i: number) {
  emit('update:modelValue', props.modelValue.filter((_, idx) => idx !== i))
}
function isEvaluative(text: string): boolean {
  const t = text.toLowerCase()
  return EVALUATIVE.some(w => t.includes(w))
}
</script>

<template>
  <div class="space-y-3">
    <div v-for="(anchor, i) in modelValue" :key="i" class="rounded-lg border border-surface-200 dark:border-surface-800 p-3 space-y-2">
      <div class="flex items-start gap-2">
        <UiInput
          :model-value="anchor.value"
          size="sm"
          placeholder="Балл"
          class="w-20 shrink-0"
          @update:model-value="v => update(i, 'value', String(v))"
        />
        <UiTextarea
          :model-value="anchor.anchorText"
          size="sm"
          :rows="2"
          autosize
          placeholder="Наблюдаемое поведение (не оценка): напр. «называет конкретных стейкхолдеров и метрику до/после»"
          @update:model-value="v => update(i, 'anchorText', v)"
        />
        <UiButton type="button" variant="ghost" size="sm" :icon-left="Trash2" icon-only aria-label="Удалить якорь" @click="removeRow(i)" />
      </div>
      <div v-if="isEvaluative(anchor.anchorText)" class="flex items-center gap-1.5 text-xs text-warning-600 dark:text-warning-400">
        <AlertTriangle :size="13" />
        <span>Оценочная лексика — опишите наблюдаемое поведение, а не оценку.</span>
      </div>
    </div>
    <span v-if="!modelValue.length" class="text-xs text-surface-400">Якоря не заданы</span>
    <UiButton type="button" variant="secondary" size="sm" :icon-left="Plus" @click="addRow">
      Добавить якорь
    </UiButton>
  </div>
</template>
