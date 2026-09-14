<script setup lang="ts">
/** Редактор шкал темы + якорей (Спринт 1). */
import { Plus, Trash2, Star } from 'lucide-vue-next'
import type { AssessmentScale, BarsAnchor, ScaleType } from '~/composables/useAssessmentTopics'
import { useAssessmentTopics } from '~/composables/useAssessmentTopics'

const props = defineProps<{ topicId: string, scales: AssessmentScale[] }>()
const emit = defineEmits<{ changed: [] }>()

const { createScale, updateScale, deleteScale, replaceAnchors } = useAssessmentTopics()

const scaleTypeOptions: { label: string, value: ScaleType }[] = [
  { label: '1–5 (числовая)', value: 'numeric_5' },
  { label: '1–4 (числовая)', value: 'numeric_4' },
  { label: '1–3 (числовая)', value: 'numeric_3' },
  { label: 'Соответствие ×3', value: 'match_3' },
  { label: 'Верификация ×3', value: 'verify_3' },
  { label: 'Уровни 0–4', value: 'level_5' },
  { label: 'Произвольная', value: 'custom' },
]

const newScaleName = ref('')
const anchorDrafts = ref<Record<string, BarsAnchor[]>>({})

function draftFor(scale: AssessmentScale): BarsAnchor[] {
  if (!anchorDrafts.value[scale.id]) {
    anchorDrafts.value[scale.id] = (scale.anchors ?? []).map(a => ({ ...a }))
  }
  return anchorDrafts.value[scale.id]
}

async function addScale() {
  if (!newScaleName.value.trim()) return
  await createScale(props.topicId, { name: newScaleName.value.trim(), type: 'numeric_5', isDefault: props.scales.length === 0 })
  newScaleName.value = ''
  emit('changed')
}
async function setDefault(scale: AssessmentScale) {
  await updateScale(scale.id, { isDefault: true })
  emit('changed')
}
async function changeType(scale: AssessmentScale, type: ScaleType) {
  await updateScale(scale.id, { type })
  emit('changed')
}
async function removeScale(scale: AssessmentScale) {
  await deleteScale(scale.id)
  emit('changed')
}
async function saveAnchors(scale: AssessmentScale) {
  await replaceAnchors(scale.id, anchorDrafts.value[scale.id] ?? [])
  emit('changed')
}
</script>

<template>
  <div class="space-y-4">
    <div v-for="scale in scales" :key="scale.id" class="rounded-lg border border-surface-200 dark:border-surface-800 p-4 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="font-medium text-sm">{{ scale.name }}</span>
          <UiBadge v-if="scale.isDefault" tone="brand" :icon="Star">По умолчанию</UiBadge>
        </div>
        <div class="flex items-center gap-1.5">
          <UiButton v-if="!scale.isDefault" type="button" variant="ghost" size="sm" @click="setDefault(scale)">
            Сделать основной
          </UiButton>
          <UiButton type="button" variant="ghost" size="sm" :icon-left="Trash2" icon-only aria-label="Удалить шкалу" @click="removeScale(scale)" />
        </div>
      </div>

      <UiSelect
        :model-value="scale.type"
        label="Тип шкалы"
        :options="scaleTypeOptions"
        @update:model-value="v => changeType(scale, v as ScaleType)"
      />

      <div>
        <p class="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">BARS-якоря (для генерации отчётов)</p>
        <QuestionBankBarsAnchorEditor
          :model-value="draftFor(scale)"
          @update:model-value="v => (anchorDrafts[scale.id] = v)"
        />
        <div class="mt-2">
          <UiButton type="button" variant="secondary" size="sm" @click="saveAnchors(scale)">
            Сохранить якоря
          </UiButton>
        </div>
      </div>
    </div>

    <div class="flex gap-2">
      <UiInput v-model="newScaleName" placeholder="Название новой шкалы" size="sm" @keydown.enter.prevent="addScale" />
      <UiButton type="button" variant="secondary" size="sm" :icon-left="Plus" @click="addScale">
        Добавить шкалу
      </UiButton>
    </div>
  </div>
</template>
