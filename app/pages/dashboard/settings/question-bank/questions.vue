<script setup lang="ts">
import { Search, Plus, Sparkles } from 'lucide-vue-next'
import { useBankQuestions, type BankQuestion, type BankQuestionStatus, type QualityIssue } from '~/composables/useBankQuestions'
import { useAssessmentTopics } from '~/composables/useAssessmentTopics'

definePageMeta({})
useSeoMeta({ title: 'Банк вопросов — Вопросы' })

const { allowed: canCreate } = usePermission({ questionBank: ['create_draft'] })
const { allowed: canPublish } = usePermission({ questionBank: ['publish'] })

const search = ref('')
const statusFilter = ref<BankQuestionStatus | ''>('')
const topicFilter = ref('')

const filters = computed(() => ({
  search: search.value,
  status: statusFilter.value,
  topicId: topicFilter.value,
  limit: 100,
}))

const { questions, isLoading, createQuestion, updateQuestion, publishQuestion, archiveQuestion, generateQuestions } = useBankQuestions(filters)
const { topics } = useAssessmentTopics(() => ({ status: 'active', limit: 100 }))

const topicOptions = computed(() => [
  { label: 'Все темы', value: '' },
  ...topics.value.map(t => ({ label: t.name, value: t.id })),
])
const statusOptions = [
  { label: 'Все статусы', value: '' },
  { label: 'Черновики', value: 'draft' },
  { label: 'Опубликованные', value: 'published' },
  { label: 'Архив', value: 'archived' },
]

// ── Drawer формы ──
const drawerOpen = ref(false)
const editing = ref<Partial<BankQuestion>>({})
const editingId = ref<string | null>(null)
const publishIssues = ref<{ blocking: QualityIssue[], warnings: QualityIssue[] } | null>(null)
const saving = ref(false)

function openCreate() {
  editingId.value = null
  editing.value = { type: 'behavioral', text: '', strongIndicators: [], weakIndicators: [] }
  publishIssues.value = null
  drawerOpen.value = true
}
function openEdit(q: BankQuestion) {
  editingId.value = q.id
  editing.value = { ...q }
  publishIssues.value = null
  drawerOpen.value = true
}

async function save() {
  if (!editing.value.text?.trim() || !editing.value.primaryTopicId) return
  saving.value = true
  try {
    if (editingId.value) await updateQuestion(editingId.value, editing.value)
    else {
      const created = await createQuestion(editing.value as Partial<BankQuestion> & { primaryTopicId: string, text: string })
      editingId.value = created?.id ?? null
    }
  }
  finally { saving.value = false }
}

async function doPublish() {
  if (!editingId.value) return
  const res = await publishQuestion(editingId.value)
  if (!res.ok) publishIssues.value = { blocking: res.blocking, warnings: res.warnings }
  else { publishIssues.value = null; drawerOpen.value = false }
}

// ── Генерация ──
const genOpen = ref(false)
const genTopic = ref('')
const genCount = ref(10)
const genBusy = ref(false)
async function doGenerate() {
  if (!genTopic.value) return
  genBusy.value = true
  try {
    await generateQuestions(genTopic.value, genCount.value)
    genOpen.value = false
  }
  finally { genBusy.value = false }
}

function statusTone(s: BankQuestionStatus) {
  return s === 'published' ? 'success' : s === 'archived' ? 'neutral' : 'warning'
}
function statusLabel(s: BankQuestionStatus) {
  return s === 'published' ? 'Опубликован' : s === 'archived' ? 'Архив' : 'Черновик'
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">Банк вопросов</h1>
      <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">Эталонные вопросы организации.</p>
    </div>

    <QuestionBankSubNav />

    <div class="flex flex-wrap items-center gap-2 mt-6 mb-4">
      <div class="flex-1 min-w-[180px]">
        <UiInput v-model="search" :icon-left="Search" placeholder="Поиск по тексту вопроса" size="sm" />
      </div>
      <UiSelect v-model="topicFilter" :options="topicOptions" size="sm" class="w-44" />
      <UiSelect v-model="statusFilter" :options="statusOptions" size="sm" class="w-40" />
      <UiButton v-if="canCreate" variant="secondary" size="sm" :icon-left="Sparkles" @click="genOpen = true">Сгенерировать</UiButton>
      <UiButton v-if="canCreate" variant="primary" size="sm" :icon-left="Plus" @click="openCreate">Вопрос</UiButton>
    </div>

    <div v-if="isLoading" class="py-12 text-center text-sm text-surface-400">Загрузка…</div>
    <div v-else-if="!questions.length" class="py-12 text-center">
      <p class="text-sm text-surface-500 dark:text-surface-400 mb-3">Пока нет вопросов, подходящих под фильтр.</p>
      <UiButton v-if="canCreate" variant="primary" size="sm" :icon-left="Plus" @click="openCreate">Создать первый вопрос</UiButton>
    </div>
    <div v-else class="space-y-2">
      <UiCard v-for="q in questions" :key="q.id" interactive @click="openEdit(q)">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm text-surface-900 dark:text-surface-100">{{ q.text }}</p>
            <div class="flex flex-wrap items-center gap-1.5 mt-2">
              <UiBadge v-if="q.primaryTopic" tone="info">{{ q.primaryTopic.name }}</UiBadge>
              <UiBadge :tone="statusTone(q.status)">{{ statusLabel(q.status) }}</UiBadge>
              <UiBadge v-if="q.careReady" tone="accent">CARE</UiBadge>
              <UiBadge v-if="q.code" tone="neutral" variant="outline">{{ q.code }}</UiBadge>
            </div>
          </div>
        </div>
      </UiCard>
    </div>

    <!-- Drawer: форма вопроса -->
    <UiDrawer v-model="drawerOpen" width="lg">
      <template #header>
        <h2 class="text-base font-semibold">{{ editingId ? 'Вопрос банка' : 'Новый вопрос' }}</h2>
      </template>

      <div class="space-y-4">
        <QuestionBankBankQuestionForm
          v-model="editing"
          :topics="topics"
          :readonly="editing.status === 'published'"
        />
        <QuestionBankQualityWarnings v-if="publishIssues" :blocking="publishIssues.blocking" :warnings="publishIssues.warnings" />
      </div>

      <template #footer>
        <div class="flex items-center justify-between gap-2">
          <UiButton
            v-if="editingId && canPublish && editing.status !== 'published'"
            variant="success" size="sm" @click="doPublish"
          >Опубликовать</UiButton>
          <span v-else />
          <div class="flex items-center gap-2">
            <UiButton variant="ghost" size="sm" @click="drawerOpen = false">Закрыть</UiButton>
            <UiButton
              v-if="editing.status !== 'published'"
              variant="primary" size="sm" :loading="saving"
              :disabled="!editing.text?.trim() || !editing.primaryTopicId"
              @click="save"
            >Сохранить</UiButton>
          </div>
        </div>
      </template>
    </UiDrawer>

    <!-- Modal: генерация -->
    <UiModal v-model="genOpen" size="sm">
      <template #header><h2 class="text-base font-semibold">Сгенерировать вопросы</h2></template>
      <div class="space-y-3">
        <UiSelect v-model="genTopic" label="Тема" :options="topicOptions.filter(o => o.value)" placeholder="Выберите тему" />
        <UiInput v-model="genCount" type="number" label="Количество" />
        <p class="text-xs text-surface-400">Сгенерированные вопросы попадут в черновики. Дубли отсеиваются.</p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" size="sm" @click="genOpen = false">Отмена</UiButton>
          <UiButton variant="primary" size="sm" :loading="genBusy" :disabled="!genTopic" @click="doGenerate">Сгенерировать</UiButton>
        </div>
      </template>
    </UiModal>
  </div>
</template>
