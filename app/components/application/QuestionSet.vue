<script setup lang="ts">
import { ListChecks, Sparkles, Loader2, Plus, Trash2, Check, SkipForward, ShieldAlert } from 'lucide-vue-next'
import type { CandidateQuestionItem } from '~/composables/useCandidateQuestions'

const props = defineProps<{
  applicationId: string
  candidateId: string
}>()

const { t } = useI18n()
const toast = useToast()
const { set, items, status, generate, addItem, updateItem, deleteItem } = useCandidateQuestions(() => props.applicationId)
const { allowed: canEdit } = usePermission({ application: ['update'] })

const isGenerating = ref(false)
async function onGenerate() {
  if (!canEdit.value) return
  isGenerating.value = true
  try {
    const res: any = await generate(3)
    if (!res?.riskAvailable) toast.info(t('application.questions.noRisk'))
    else toast.success(t('application.questions.generated', { n: res?.insertedCount ?? 0 }))
  }
  catch { toast.error(t('application.questions.error')) }
  finally { isGenerating.value = false }
}

// Group: risk-derived first, then bank by category.
const riskItems = computed(() => items.value.filter(i => i.origin === 'risk_derived'))
const otherItems = computed(() => items.value.filter(i => i.origin !== 'risk_derived'))

async function toggleAsked(i: CandidateQuestionItem) {
  const next = i.askStatus === 'asked' ? 'pending' : 'asked'
  try { await updateItem(i.id, { askStatus: next }) } catch { /* handled */ }
}
async function toggleSkipped(i: CandidateQuestionItem) {
  const next = i.askStatus === 'skipped' ? 'pending' : 'skipped'
  try { await updateItem(i.id, { askStatus: next }) } catch { /* handled */ }
}
async function saveNote(i: CandidateQuestionItem, val: string) {
  if (val === (i.answerNote ?? '')) return
  try { await updateItem(i.id, { answerNote: val }) } catch { toast.error(t('application.questions.saveError')) }
}
async function onDelete(i: CandidateQuestionItem) {
  try { await deleteItem(i.id) } catch { toast.error(t('application.questions.saveError')) }
}

const newText = ref('')
async function onAdd() {
  const v = newText.value.trim()
  if (!v) return
  try { await addItem({ text: v }); newText.value = '' }
  catch { toast.error(t('application.questions.saveError')) }
}
</script>

<template>
  <div class="rounded-lg border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-900">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="inline-flex items-center gap-1.5 text-sm font-semibold text-surface-700 dark:text-surface-200">
        <ListChecks class="size-4 text-brand-600" />
        {{ t('application.questions.title') }}
      </h2>
      <button
        v-if="canEdit"
        type="button"
        :disabled="isGenerating"
        class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        @click="onGenerate"
      >
        <Loader2 v-if="isGenerating" class="size-3.5 animate-spin" />
        <Sparkles v-else class="size-3.5" />
        {{ items.length ? t('application.questions.regenerate') : t('application.questions.generate') }}
      </button>
    </div>

    <div v-if="status === 'pending'" class="py-6 text-center text-sm text-surface-400">…</div>
    <p v-else-if="!items.length" class="text-xs text-surface-500 dark:text-surface-400">
      {{ t('application.questions.empty') }}
    </p>

    <div v-else class="space-y-4">
      <!-- Risk-derived first -->
      <div v-if="riskItems.length">
        <h3 class="mb-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-amber-600">
          <ShieldAlert class="size-3.5" /> {{ t('application.questions.fromRisks') }}
        </h3>
        <ul class="space-y-2">
          <li v-for="i in riskItems" :key="i.id" class="rounded-lg border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-900 dark:bg-amber-950/20">
            <ApplicationQuestionSetItem
              :item="i" :can-edit="canEdit"
              @asked="toggleAsked(i)" @skipped="toggleSkipped(i)"
              @note="v => saveNote(i, v)" @delete="onDelete(i)"
            />
          </li>
        </ul>
      </div>

      <!-- Bank -->
      <div v-if="otherItems.length">
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">
          {{ t('application.questions.fromBank') }}
        </h3>
        <ul class="space-y-2">
          <li v-for="i in otherItems" :key="i.id" class="rounded-lg border border-surface-200 p-3 dark:border-surface-800">
            <ApplicationQuestionSetItem
              :item="i" :can-edit="canEdit"
              @asked="toggleAsked(i)" @skipped="toggleSkipped(i)"
              @note="v => saveNote(i, v)" @delete="onDelete(i)"
            />
          </li>
        </ul>
      </div>
    </div>

    <!-- Manual add -->
    <div v-if="canEdit" class="mt-4 flex gap-2">
      <input
        v-model="newText"
        type="text"
        :placeholder="t('application.questions.addPlaceholder')"
        class="flex-1 rounded-md border border-surface-200 bg-white px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-800"
        @keydown.enter.prevent="onAdd"
      >
      <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-surface-200 px-3 text-sm text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:hover:bg-surface-800" @click="onAdd">
        <Plus class="size-4" /> {{ t('application.questions.add') }}
      </button>
    </div>
  </div>
</template>
