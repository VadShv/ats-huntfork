<script setup lang="ts">
/**
 * Панель карты вопросов вакансии (Спринт 3): импорт пресета + матрица покрытия
 * критериев + сигнал доступных обновлений org-версии.
 */
import { Download, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-vue-next'
import { useQuestionPresets } from '~/composables/useQuestionPresets'
import { useJobQuestionnaire } from '~/composables/useJobQuestionnaire'

const props = defineProps<{ jobId: string, canEdit?: boolean }>()
const emit = defineEmits<{ imported: [] }>()

const { presets } = useQuestionPresets(() => ({ status: 'published' }))
const { matrix, importPreset, syncUpdates, refreshMatrix } = useJobQuestionnaire(() => props.jobId)

const selectedPreset = ref('')
const importing = ref(false)
const presetOptions = computed(() => [
  { label: 'Выберите пресет…', value: '' },
  ...presets.value.map(p => ({ label: `${p.name}${p.isDefault ? ' (реком.)' : ''}`, value: p.id })),
])

async function doImport(replace: boolean) {
  if (!selectedPreset.value) return
  importing.value = true
  try {
    await importPreset(selectedPreset.value, replace)
    emit('imported')
  }
  finally { importing.value = false }
}

async function acceptAllUpdates() {
  const ups = matrix.value?.updatesAvailable ?? []
  if (!ups.length) return
  await syncUpdates(ups.map(u => ({ questionId: u.questionId, fields: ['text', 'rationale', 'goodAnswer'] })), [])
  emit('imported')
}
async function keepAllLocal() {
  const ups = matrix.value?.updatesAvailable ?? []
  if (!ups.length) return
  await syncUpdates([], ups.map(u => ({ questionId: u.questionId })))
}

defineExpose({ refreshMatrix })
</script>

<template>
  <UiCard class="mb-6" tone="neutral">
    <div class="space-y-4">
      <!-- Импорт пресета -->
      <div v-if="canEdit" class="flex flex-wrap items-end gap-2">
        <div class="flex-1 min-w-[200px]">
          <UiSelect v-model="selectedPreset" label="Опросная карта из пресета" :options="presetOptions" size="sm" />
        </div>
        <UiButton variant="primary" size="sm" :icon-left="Download" :loading="importing" :disabled="!selectedPreset" @click="doImport(false)">
          Импортировать
        </UiButton>
        <UiButton variant="ghost" size="sm" :disabled="!selectedPreset" @click="doImport(true)">
          Заменить
        </UiButton>
      </div>

      <!-- Матрица покрытия -->
      <div v-if="matrix">
        <div v-if="!matrix.hasCriteria" class="text-xs text-surface-500 dark:text-surface-400 flex items-center gap-1.5">
          <AlertTriangle :size="14" />
          У вакансии нет критериев оценки — матрица покрытия недоступна. Сначала задайте критерии.
        </div>
        <template v-else>
          <div class="flex items-center justify-between mb-2">
            <p class="text-sm font-medium">Покрытие критериев</p>
            <span class="text-xs text-surface-500">
              {{ matrix.coverage.filter(c => c.covered).length }}/{{ matrix.coverage.length }} покрыто
            </span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <UiBadge
              v-for="c in matrix.coverage" :key="c.criterionId"
              :tone="c.covered ? 'success' : 'warning'"
              :icon="c.covered ? CheckCircle2 : AlertTriangle"
            >
              {{ c.name || c.key }}<span v-if="c.covered" class="opacity-70"> · {{ c.questionCount }}</span>
            </UiBadge>
          </div>
          <p v-if="matrix.uncategorizedQuestions" class="text-xs text-surface-400 mt-2">
            Без привязки к критерию: {{ matrix.uncategorizedQuestions }}
          </p>
        </template>
      </div>

      <!-- Обновления org-версии -->
      <div v-if="matrix?.updatesAvailable?.length" class="rounded-lg border border-info-300 bg-info-50 dark:border-info-800 dark:bg-info-950/40 p-3">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 text-sm text-info-700 dark:text-info-300">
            <RefreshCw :size="14" />
            Доступны обновления вопросов из банка ({{ matrix.updatesAvailable.length }})
          </div>
          <div v-if="canEdit" class="flex items-center gap-1.5">
            <UiButton variant="ghost" size="sm" @click="keepAllLocal">Оставить своё</UiButton>
            <UiButton variant="primary" size="sm" @click="acceptAllUpdates">Обновить все</UiButton>
          </div>
        </div>
      </div>
    </div>
  </UiCard>
</template>
