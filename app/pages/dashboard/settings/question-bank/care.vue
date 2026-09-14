<script setup lang="ts">
import { Plus, Trash2 } from 'lucide-vue-next'
import { useCare, type CareElement, type CarePromptKind } from '~/composables/useCare'

definePageMeta({})
useSeoMeta({ title: 'Банк вопросов — Методология CARE' })

const { allowed: canManage } = usePermission({ questionBank: ['manage_care'] })
const {
  methodology, prompts, triggers,
  saveMethodology, savePrompt, saveTriggers,
} = useCare()

const tabs = [
  { key: 'methodology', label: 'Методика' },
  { key: 'prompts', label: 'Промпты' },
  { key: 'triggers', label: 'Триггеры уточнений' },
]
const activeTab = ref('methodology')

// ── Методика (локальная копия для правки) ──
const mDraft = reactive({
  title: '', description: '', interviewerInstruction: '',
  probeLimitPerElement: 3, probeLimitPerQuestion: 6, changeNote: '',
})
watch(methodology, (m) => {
  if (!m) return
  mDraft.title = m.title
  mDraft.description = m.description ?? ''
  mDraft.interviewerInstruction = m.interviewerInstruction ?? ''
  mDraft.probeLimitPerElement = m.probeLimitPerElement
  mDraft.probeLimitPerQuestion = m.probeLimitPerQuestion
  mDraft.changeNote = ''
}, { immediate: true })

const savingM = ref(false)
async function submitMethodology() {
  savingM.value = true
  try { await saveMethodology({ ...mDraft }) }
  finally { savingM.value = false }
}

// ── Промпты ──
const promptKind = ref<CarePromptKind>('structure_question')
const promptText = ref('')
const promptChangeNote = ref('')
const kindLabels: Record<CarePromptKind, string> = {
  structure_question: 'Структурирование вопроса',
  personalize_questionnaire: 'Персонализация опросника',
  generate_report: 'Генерация отчёта',
}
const currentPrompt = computed(() => prompts.value.find(p => p.kind === promptKind.value))
watch([currentPrompt], () => { promptText.value = currentPrompt.value?.promptText ?? ''; promptChangeNote.value = '' }, { immediate: true })
const savingP = ref(false)
async function submitPrompt() {
  if (!currentPrompt.value) return
  savingP.value = true
  try { await savePrompt(promptKind.value, promptText.value, currentPrompt.value.variables, promptChangeNote.value) }
  finally { savingP.value = false }
}

// ── Триггеры ──
const triggerDrafts = ref<{ id?: string, trigger: string, recommendedProbe: string, careElement: CareElement | null, isActive: boolean, isBuiltin: boolean, displayOrder: number }[]>([])
watch(triggers, (list) => {
  triggerDrafts.value = list.map(t => ({ ...t }))
}, { immediate: true })
const careElementOptions = [
  { label: 'Любой', value: '' },
  { label: 'Context', value: 'context' },
  { label: 'Action', value: 'action' },
  { label: 'Result', value: 'result' },
  { label: 'Evaluate', value: 'evaluate' },
]
function addTrigger() {
  triggerDrafts.value.push({ trigger: '', recommendedProbe: '', careElement: null, isActive: true, isBuiltin: false, displayOrder: triggerDrafts.value.length })
}
function removeTrigger(i: number) {
  triggerDrafts.value.splice(i, 1)
}
const savingT = ref(false)
async function submitTriggers() {
  savingT.value = true
  try {
    await saveTriggers(triggerDrafts.value.map((t, i) => ({
      id: t.id, trigger: t.trigger, recommendedProbe: t.recommendedProbe,
      careElement: t.careElement, isActive: t.isActive, displayOrder: i,
    })))
  }
  finally { savingT.value = false }
}
</script>

<template>
  <div>
    <div v-if="methodology" class="mb-4 flex items-center gap-2 text-sm text-surface-500">
      <UiBadge tone="brand">Версия {{ methodology.version }}</UiBadge>
      <span>Активная методика организации</span>
    </div>

    <DetailTabs v-model="activeTab" :tabs="tabs" />

    <!-- Методика -->
    <div v-if="activeTab === 'methodology'" class="mt-6 space-y-4">
      <UiInput v-model="mDraft.title" label="Название методики" :readonly="!canManage" />
      <UiTextarea v-model="mDraft.description" label="Описание модели" :rows="5" autosize :readonly="!canManage" />
      <UiTextarea v-model="mDraft.interviewerInstruction" label="Инструкция интервьюеру" :rows="5" autosize :readonly="!canManage" />
      <div class="grid grid-cols-2 gap-3">
        <UiInput v-model="mDraft.probeLimitPerElement" type="number" label="Probe на элемент" :readonly="!canManage" />
        <UiInput v-model="mDraft.probeLimitPerQuestion" type="number" label="Probe на вопрос" :readonly="!canManage" />
      </div>
      <UiInput v-if="canManage" v-model="mDraft.changeNote" label="Что изменилось (для истории)" placeholder="необязательно" />
      <div v-if="canManage" class="flex justify-end">
        <UiButton variant="primary" size="sm" :loading="savingM" @click="submitMethodology">Сохранить (новая версия)</UiButton>
      </div>
    </div>

    <!-- Промпты -->
    <div v-else-if="activeTab === 'prompts'" class="mt-6 space-y-4">
      <UiSegmented
        v-model="promptKind"
        :options="(Object.keys(kindLabels) as CarePromptKind[]).map(k => ({ label: kindLabels[k], value: k }))"
      />
      <UiTextarea
        v-model="promptText"
        label="Системный промпт"
        :rows="14"
        autosize
        :max-height="600"
        :readonly="!canManage"
        hint="Плейсхолдеры {{name}} подставляются при генерации."
      />
      <div v-if="currentPrompt?.variables?.length" class="text-xs text-surface-500">
        Переменные: <span v-for="v in currentPrompt.variables" :key="v.name" class="font-mono">{{ '{{' + v.name + '}}' }} </span>
      </div>
      <UiInput v-if="canManage" v-model="promptChangeNote" label="Что изменилось" placeholder="необязательно" />
      <div v-if="canManage" class="flex justify-end">
        <UiButton variant="primary" size="sm" :loading="savingP" :disabled="!promptText.trim()" @click="submitPrompt">
          Сохранить промпт
        </UiButton>
      </div>
    </div>

    <!-- Триггеры -->
    <div v-else class="mt-6 space-y-3">
      <p class="text-sm text-surface-500">
        Правила уточнений: сигнал в ответе кандидата → рекомендуемое уточнение. Встроенные нельзя удалить, только отключить.
      </p>
      <div v-for="(t, i) in triggerDrafts" :key="t.id || i" class="rounded-lg border border-surface-200 dark:border-surface-800 p-3 space-y-2">
        <div class="flex items-start gap-2">
          <UiInput v-model="t.trigger" size="sm" placeholder="Сигнал (напр. говорит «мы»)" :readonly="!canManage" />
          <UiInput v-model="t.recommendedProbe" size="sm" placeholder="Уточнение" :readonly="!canManage" />
          <UiSelect
            :model-value="t.careElement ?? ''"
            :options="careElementOptions"
            size="sm"
            class="w-32 shrink-0"
            :disabled="!canManage"
            @update:model-value="v => (t.careElement = (v || null) as CareElement | null)"
          />
          <UiButton v-if="canManage && !t.isBuiltin" type="button" variant="ghost" size="sm" :icon-left="Trash2" icon-only aria-label="Удалить" @click="removeTrigger(i)" />
          <UiBadge v-if="t.isBuiltin" tone="neutral" variant="outline" class="shrink-0">встроенный</UiBadge>
        </div>
      </div>
      <div v-if="canManage" class="flex items-center justify-between">
        <UiButton type="button" variant="secondary" size="sm" :icon-left="Plus" @click="addTrigger">Добавить триггер</UiButton>
        <UiButton variant="primary" size="sm" :loading="savingT" @click="submitTriggers">Сохранить триггеры</UiButton>
      </div>
    </div>
  </div>
</template>
