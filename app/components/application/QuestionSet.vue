<script setup lang="ts">
import { ListChecks, Sparkles, Plus, ShieldAlert, Wand2, Lock, RefreshCw } from 'lucide-vue-next'
import type { CandidateQuestionItem, CandidateQuestionNode } from '~/composables/useCandidateQuestions'

const props = defineProps<{
  applicationId: string
  candidateId: string
}>()

const { t } = useI18n()
const toast = useToast()
const { set, items, tree, personalizing, status, generate, personalize, confirm, addItem, updateItem, deleteItem } = useCandidateQuestions(() => props.applicationId)
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

async function onPersonalize() { try { await personalize() } catch { /* handled */ } }
async function onConfirm() { try { await confirm() } catch { toast.error(t('application.questions.saveError')) } }

const isSnapshot = computed(() => set.value?.isSnapshot === true)
const isStale = computed(() => set.value?.isStale === true)

// Group: risk-derived first, then others. Работаем на дереве (probe вложены).
const riskItems = computed(() => tree.value.filter(i => i.origin === 'risk_derived'))
const otherItems = computed(() => tree.value.filter(i => i.origin !== 'risk_derived'))

const priorityTone: Record<string, 'danger' | 'warning' | 'neutral'> = { must_ask: 'danger', should_ask: 'warning', optional: 'neutral' }
const priorityLabel: Record<string, string> = { must_ask: 'Обязательно', should_ask: 'Желательно', optional: 'Опционально' }
const careLabel: Record<string, string> = { context: 'Ситуация', action: 'Действия', result: 'Результат', evaluate: 'Выводы' }

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
        <UiBadge v-if="isSnapshot" tone="info" :icon="Lock" size="sm">Зафиксирован{{ set?.version ? ` · v${set.version}` : '' }}</UiBadge>
        <UiBadge v-else-if="set?.personalizedAt" tone="accent" size="sm">Персонализирован</UiBadge>
      </h2>
      <div v-if="canEdit" class="flex items-center gap-1.5">
        <UiButton v-if="items.length && !isSnapshot" size="xs" variant="secondary" :icon-left="Wand2" :loading="personalizing" @click="onPersonalize">
          Персонализировать
        </UiButton>
        <UiButton v-if="items.length && !isSnapshot" size="xs" variant="ghost" @click="onConfirm">
          Зафиксировать
        </UiButton>
        <UiButton size="xs" :icon-left="Sparkles" :loading="isGenerating" @click="onGenerate">
          {{ isSnapshot ? 'Новая версия' : (items.length ? t('application.questions.regenerate') : t('application.questions.generate')) }}
        </UiButton>
      </div>
    </div>

    <div v-if="isStale && !isSnapshot" class="mb-3 flex items-center gap-1.5 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:border-warning-800 dark:bg-warning-950/40 dark:text-warning-300">
      <RefreshCw class="size-3.5" /> Данные обновились — перегенерируйте опросник.
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
            <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
              <UiBadge :tone="priorityTone[i.priority]" size="sm">{{ priorityLabel[i.priority] }}</UiBadge>
              <UiBadge v-if="i.isPersonalized" tone="accent" size="sm">персонализ.</UiBadge>
            </div>
            <ApplicationQuestionSetItem
              :item="i" :can-edit="canEdit && !isSnapshot"
              @asked="toggleAsked(i)" @skipped="toggleSkipped(i)"
              @note="v => saveNote(i, v)" @delete="onDelete(i)"
            />
            <ApplicationQuestionSetProbes v-if="i.probes.length" :probes="i.probes" :care-label="careLabel" />
          </li>
        </ul>
      </div>

      <!-- Bank / прочие -->
      <div v-if="otherItems.length">
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">
          {{ t('application.questions.fromBank') }}
        </h3>
        <ul class="space-y-2">
          <li v-for="i in otherItems" :key="i.id" class="rounded-lg border border-surface-200 p-3 dark:border-surface-800">
            <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
              <UiBadge :tone="priorityTone[i.priority]" size="sm">{{ priorityLabel[i.priority] }}</UiBadge>
              <UiBadge v-if="i.isPersonalized" tone="accent" size="sm">персонализ.</UiBadge>
            </div>
            <ApplicationQuestionSetItem
              :item="i" :can-edit="canEdit && !isSnapshot"
              @asked="toggleAsked(i)" @skipped="toggleSkipped(i)"
              @note="v => saveNote(i, v)" @delete="onDelete(i)"
            />
            <ApplicationQuestionSetProbes v-if="i.probes.length" :probes="i.probes" :care-label="careLabel" />
          </li>
        </ul>
      </div>
    </div>

    <!-- Manual add -->
    <div v-if="canEdit && !isSnapshot" class="mt-4 flex gap-2">
      <UiInput
        v-model="newText"
        :placeholder="t('application.questions.addPlaceholder')"
        size="sm"
        class="flex-1"
        @keydown.enter.prevent="onAdd"
      />
      <UiButton variant="secondary" size="sm" :icon-left="Plus" @click="onAdd">
        {{ t('application.questions.add') }}
      </UiButton>
    </div>
  </div>
</template>
