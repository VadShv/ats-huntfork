<script setup lang="ts">
import { MessageCircleQuestion, Sparkles, Loader2, Plus, Trash2, Archive, ArchiveRestore, Pencil, Check, X } from 'lucide-vue-next'
import type { InterviewQuestion } from '~/composables/useInterviewQuestions'

const { t } = useI18n()

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const jobId = route.params.id as string
const toast = useToast()

const { job } = useJob(jobId)
const {
  questions, prompt, status,
  generate, addQuestion, updateQuestion, deleteQuestion, savePrompt,
} = useInterviewQuestions(jobId)
const { allowed: canEdit } = usePermission({ job: ['update'] })

useSeoMeta({
  title: computed(() =>
    job.value ? `${t('dashboard.jobs.questions.pageTitle')} — ${job.value.title}` : t('dashboard.jobs.questions.pageTitle'),
  ),
})

// ── Prompt + generation ──
const promptText = ref('')
const count = ref(10)
watch(prompt, (p) => { if (p) promptText.value = p.promptText }, { immediate: true })

const isGenerating = ref(false)
async function onGenerate() {
  if (!canEdit.value) return
  isGenerating.value = true
  try {
    const res: any = await generate({ promptText: promptText.value, count: count.value })
    toast.success(t('dashboard.jobs.questions.saved'), {
      message: `+${res?.insertedCount ?? 0}`,
    })
  }
  catch {
    toast.error(t('dashboard.jobs.questions.generateError'))
  }
  finally {
    isGenerating.value = false
  }
}

async function onSavePromptBlur() {
  if (!canEdit.value) return
  try { await savePrompt(promptText.value) }
  catch { /* handled by composable */ }
}

const showArchived = ref(false)
const visibleQuestions = computed(() =>
  (questions.value ?? []).filter(q => showArchived.value ? true : !q.isArchived),
)
const grouped = computed(() => {
  const groups: Record<string, InterviewQuestion[]> = {}
  for (const q of visibleQuestions.value) {
    ;(groups[q.category] ??= []).push(q)
  }
  return groups
})

const hasArchived = computed(() => (questions.value ?? []).some(q => q.isArchived))

// ── Inline edit ──
const editingId = ref<string | null>(null)
const editText = ref('')
function startEdit(q: InterviewQuestion) {
  editingId.value = q.id
  editText.value = q.text
}
async function saveEdit(q: InterviewQuestion) {
  const val = editText.value.trim()
  if (val && val !== q.text) {
    try { await updateQuestion(q.id, { text: val }) }
    catch { toast.error(t('dashboard.jobs.questions.saveError')) }
  }
  editingId.value = null
}

async function toggleArchive(q: InterviewQuestion) {
  try { await updateQuestion(q.id, { isArchived: !q.isArchived }) }
  catch { toast.error(t('dashboard.jobs.questions.saveError')) }
}
async function onDelete(q: InterviewQuestion) {
  try { await deleteQuestion(q.id) }
  catch { toast.error(t('dashboard.jobs.questions.saveError')) }
}

// ── Manual add ──
const newText = ref('')
async function onAdd() {
  const val = newText.value.trim()
  if (!val) return
  try {
    await addQuestion({ text: val })
    newText.value = ''
  }
  catch { toast.error(t('dashboard.jobs.questions.saveError')) }
}

function sourceLabel(s: InterviewQuestion['source']) {
  return s === 'ai_generated'
    ? t('dashboard.jobs.questions.sourceAi')
    : s === 'edited'
      ? t('dashboard.jobs.questions.sourceEdited')
      : t('dashboard.jobs.questions.sourceManual')
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6">
    <div class="mb-6">
      <h1 class="flex items-center gap-2 text-lg font-semibold text-surface-900 dark:text-surface-100">
        <MessageCircleQuestion class="size-5 text-brand-600" />
        {{ t('dashboard.jobs.questions.title') }}
      </h1>
      <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
        {{ t('dashboard.jobs.questions.subtitle') }}
      </p>
    </div>

    <p v-if="!canEdit" class="mb-4 rounded-lg bg-surface-50 px-3 py-2 text-xs text-surface-500 dark:bg-surface-800/50 dark:text-surface-400">
      {{ t('dashboard.jobs.questions.readOnlyHint') }}
    </p>

    <!-- Prompt + generate -->
    <section v-if="canEdit" class="mb-6 rounded-lg border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-900">
      <label class="block text-sm font-medium text-surface-700 dark:text-surface-200">{{ t('dashboard.jobs.questions.promptLabel') }}</label>
      <p class="mb-2 text-xs text-surface-400">{{ t('dashboard.jobs.questions.promptHint') }}</p>
      <textarea
        v-model="promptText"
        rows="3"
        :placeholder="t('dashboard.jobs.questions.promptPlaceholder')"
        class="w-full rounded-md border border-surface-200 bg-white px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-800"
        @blur="onSavePromptBlur"
      />
      <div class="mt-3 flex items-center gap-3">
        <label class="text-xs text-surface-500">{{ t('dashboard.jobs.questions.countLabel') }}</label>
        <input v-model.number="count" type="number" min="1" max="30" class="w-16 rounded-md border border-surface-200 bg-white px-2 py-1 text-sm dark:border-surface-700 dark:bg-surface-800">
        <UiButton
          class="ml-auto"
          :loading="isGenerating"
          :icon-left="Sparkles"
          @click="onGenerate"
        >
          {{ isGenerating ? t('dashboard.jobs.questions.generating') : (questions?.length ? t('dashboard.jobs.questions.regenerate') : t('dashboard.jobs.questions.generate')) }}
        </UiButton>
      </div>
    </section>

    <!-- List -->
    <div v-if="status === 'pending'" class="flex items-center gap-2 py-12 text-surface-400">
      <Loader2 class="size-4 animate-spin" /> …
    </div>
    <div v-else-if="!visibleQuestions.length" class="rounded-lg border border-dashed border-surface-300 p-8 text-center text-sm text-surface-500 dark:border-surface-700">
      {{ t('dashboard.jobs.questions.empty') }}
    </div>

    <div v-else class="space-y-5">
      <div v-for="(items, cat) in grouped" :key="cat">
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">
          {{ t(`dashboard.jobs.questions.category.${cat}`) }}
        </h3>
        <ul class="space-y-2">
          <li
            v-for="q in items"
            :key="q.id"
            class="rounded-lg border border-surface-200 bg-white p-3 dark:border-surface-800 dark:bg-surface-900"
            :class="{ 'opacity-50': q.isArchived }"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <template v-if="editingId === q.id">
                  <textarea
                    v-model="editText"
                    rows="2"
                    class="w-full rounded-md border border-surface-200 bg-white px-2 py-1 text-sm dark:border-surface-700 dark:bg-surface-800"
                  />
                  <div class="mt-1 flex gap-2">
                    <UiButton variant="ghost" size="xs" :icon-left="Check" class="text-success-600" @click="saveEdit(q)">OK</UiButton>
                    <UiButton icon-only variant="ghost" size="xs" aria-label="Отмена" @click="editingId = null"><X class="size-3" /></UiButton>
                  </div>
                </template>
                <template v-else>
                  <p class="text-sm text-surface-800 dark:text-surface-100">{{ q.text }}</p>
                  <p v-if="q.rationale" class="mt-1 text-xs text-surface-400">{{ q.rationale }}</p>
                </template>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <span class="rounded bg-surface-100 px-1.5 py-0.5 text-[10px] text-surface-500 dark:bg-surface-800">{{ sourceLabel(q.source) }}</span>
                <template v-if="canEdit && editingId !== q.id">
                  <UiButton icon-only variant="ghost" size="xs" :title="t('dashboard.jobs.questions.archive')" @click="startEdit(q)"><Pencil class="size-3.5" /></UiButton>
                  <UiButton icon-only variant="ghost" size="xs" aria-label="Архив" @click="toggleArchive(q)">
                    <ArchiveRestore v-if="q.isArchived" class="size-3.5" />
                    <Archive v-else class="size-3.5" />
                  </UiButton>
                  <UiButton icon-only variant="ghost" size="xs" class="hover:text-danger-600" aria-label="Удалить" @click="onDelete(q)"><Trash2 class="size-3.5" /></UiButton>
                </template>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Manual add + archive toggle -->
    <div v-if="canEdit" class="mt-6 space-y-3">
      <div class="flex gap-2">
        <input
          v-model="newText"
          type="text"
          :placeholder="t('dashboard.jobs.questions.questionPlaceholder')"
          class="flex-1 rounded-md border border-surface-200 bg-white px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-800"
          @keydown.enter.prevent="onAdd"
        >
        <UiButton variant="secondary" :icon-left="Plus" @click="onAdd">
          {{ t('dashboard.jobs.questions.addManual') }}
        </UiButton>
      </div>
      <UiButton
        v-if="hasArchived"
        variant="link"
        size="xs"
        class="text-surface-400"
        @click="showArchived = !showArchived"
      >
        {{ showArchived ? t('dashboard.jobs.questions.hideArchived') : t('dashboard.jobs.questions.showArchived') }}
      </UiButton>
    </div>
  </div>
</template>
