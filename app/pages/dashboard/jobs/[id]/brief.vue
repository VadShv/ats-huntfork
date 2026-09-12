<script setup lang="ts">
import { ClipboardList, Lock, Loader2, Check, X, Plus } from 'lucide-vue-next'
import type { JobBriefInput } from '~/composables/useJobBrief'

const { t } = useI18n()

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const jobId = route.params.id as string
const toast = useToast()

const { job } = useJob(jobId)
const { brief, status, error, saveBrief } = useJobBrief(jobId)
const { allowed: canEdit } = usePermission({ job: ['update'] })

useSeoMeta({
  title: computed(() =>
    job.value ? `${t('dashboard.jobs.brief.pageTitle')} — ${job.value.title}` : t('dashboard.jobs.brief.pageTitle'),
  ),
})

// ── Local editable form, hydrated from the fetched brief ──
const form = reactive<Required<JobBriefInput>>({
  hardMustHave: [],
  niceToHave: [],
  dealBreakers: [],
  redFlagsToWatch: [],
  responsibilities: '',
  teamContext: '',
  interviewProcess: '',
  compensationNotes: '',
  idealProfile: '',
  sourcingHints: '',
  freeform: '',
})

watch(brief, (b) => {
  if (!b) return
  form.hardMustHave = [...b.hardMustHave]
  form.niceToHave = [...b.niceToHave]
  form.dealBreakers = [...b.dealBreakers]
  form.redFlagsToWatch = [...b.redFlagsToWatch]
  form.responsibilities = b.responsibilities ?? ''
  form.teamContext = b.teamContext ?? ''
  form.interviewProcess = b.interviewProcess ?? ''
  form.compensationNotes = b.compensationNotes ?? ''
  form.idealProfile = b.idealProfile ?? ''
  form.sourcingHints = b.sourcingHints ?? ''
  form.freeform = b.freeform ?? ''
}, { immediate: true })

// ── Chip input helpers ──
const chipDrafts = reactive<Record<string, string>>({
  hardMustHave: '', niceToHave: '', dealBreakers: '', redFlagsToWatch: '',
})
type ChipField = 'hardMustHave' | 'niceToHave' | 'dealBreakers' | 'redFlagsToWatch'
function addChip(field: ChipField) {
  const val = chipDrafts[field].trim()
  if (!val) return
  if (!form[field].includes(val)) form[field].push(val)
  chipDrafts[field] = ''
}
function removeChip(field: ChipField, idx: number) {
  form[field].splice(idx, 1)
}

// ── Save ──
const isSaving = ref(false)
const savedFlash = ref(false)
async function onSave() {
  if (!canEdit.value) return
  isSaving.value = true
  try {
    await saveBrief({ ...form })
    savedFlash.value = true
    setTimeout(() => { savedFlash.value = false }, 2000)
  }
  catch {
    toast.error(t('dashboard.jobs.brief.saveError'))
  }
  finally {
    isSaving.value = false
  }
}

const chipFields: Array<{ field: ChipField, label: string, hint?: string }> = [
  { field: 'hardMustHave', label: 'dashboard.jobs.brief.hardMustHave', hint: 'dashboard.jobs.brief.hardMustHaveHint' },
  { field: 'niceToHave', label: 'dashboard.jobs.brief.niceToHave' },
  { field: 'dealBreakers', label: 'dashboard.jobs.brief.dealBreakers', hint: 'dashboard.jobs.brief.dealBreakersHint' },
  { field: 'redFlagsToWatch', label: 'dashboard.jobs.brief.redFlagsToWatch' },
]

const textSections: Array<{ group: string, fields: Array<{ key: keyof typeof form, label: string, hint?: string }> }> = [
  { group: 'dashboard.jobs.brief.roleContext', fields: [
    { key: 'responsibilities', label: 'dashboard.jobs.brief.responsibilities', hint: 'dashboard.jobs.brief.responsibilitiesHint' },
    { key: 'teamContext', label: 'dashboard.jobs.brief.teamContext' },
    { key: 'idealProfile', label: 'dashboard.jobs.brief.idealProfile' },
  ] },
  { group: 'dashboard.jobs.brief.process', fields: [
    { key: 'interviewProcess', label: 'dashboard.jobs.brief.interviewProcess' },
    { key: 'compensationNotes', label: 'dashboard.jobs.brief.compensationNotes', hint: 'dashboard.jobs.brief.compensationNotesHint' },
  ] },
  { group: 'dashboard.jobs.brief.sourcing', fields: [
    { key: 'sourcingHints', label: 'dashboard.jobs.brief.sourcingHints' },
  ] },
  { group: 'dashboard.jobs.brief.notes', fields: [
    { key: 'freeform', label: 'dashboard.jobs.brief.freeform', hint: 'dashboard.jobs.brief.freeformHint' },
  ] },
]
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6">
    <!-- Header -->
    <div class="mb-6 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="flex items-center gap-2 text-lg font-semibold text-surface-900 dark:text-surface-100">
          <ClipboardList class="size-5 text-brand-600" />
          {{ t('dashboard.jobs.brief.title') }}
        </h1>
        <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
          {{ t('dashboard.jobs.brief.subtitle') }}
        </p>
      </div>
      <span class="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-50 px-2.5 py-1 text-xs font-medium text-warning-700 ring-1 ring-warning-200 dark:bg-warning-950/60 dark:text-warning-400 dark:ring-warning-800">
        <Lock class="size-3" /> {{ t('dashboard.jobs.brief.internalBadge') }}
      </span>
    </div>

    <div v-if="status === 'pending'" class="flex items-center gap-2 py-12 text-surface-400">
      <Loader2 class="size-4 animate-spin" /> …
    </div>
    <div v-else-if="error" class="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-950/40 dark:text-danger-400">
      {{ t('dashboard.jobs.brief.loadError') }}
    </div>

    <div v-else class="space-y-6">
      <p v-if="!canEdit" class="rounded-lg bg-surface-50 px-3 py-2 text-xs text-surface-500 dark:bg-surface-800/50 dark:text-surface-400">
        {{ t('dashboard.jobs.brief.readOnlyHint') }}
      </p>

      <!-- Requirements (chips) -->
      <section class="rounded-lg border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-900">
        <h2 class="mb-4 text-sm font-semibold text-surface-700 dark:text-surface-200">{{ t('dashboard.jobs.brief.requirements') }}</h2>
        <div class="space-y-4">
          <div v-for="cf in chipFields" :key="cf.field">
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-300">{{ t(cf.label) }}</label>
            <p v-if="cf.hint" class="mb-1 text-xs text-surface-400">{{ t(cf.hint) }}</p>
            <div class="mt-1 flex flex-wrap gap-1.5">
              <span
                v-for="(chip, idx) in form[cf.field]"
                :key="`${cf.field}-${idx}`"
                class="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
              >
                {{ chip }}
                <button v-if="canEdit" type="button" class="hover:text-brand-900" @click="removeChip(cf.field, idx)">
                  <X class="size-3" />
                </button>
              </span>
            </div>
            <div v-if="canEdit" class="mt-2 flex gap-2">
              <input
                v-model="chipDrafts[cf.field]"
                type="text"
                :placeholder="t('dashboard.jobs.brief.chipPlaceholder')"
                class="flex-1 rounded-md border border-surface-200 bg-white px-2.5 py-1.5 text-sm dark:border-surface-700 dark:bg-surface-800"
                @keydown.enter.prevent="addChip(cf.field)"
              >
              <UiButton
                type="button"
                variant="secondary"
                icon-only
                size="sm"
                :icon-left="Plus"
                @click="addChip(cf.field)"
              >
              </UiButton>
            </div>
          </div>
        </div>
      </section>

      <!-- Free text sections -->
      <section
        v-for="sec in textSections"
        :key="sec.group"
        class="rounded-lg border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-900"
      >
        <h2 class="mb-4 text-sm font-semibold text-surface-700 dark:text-surface-200">{{ t(sec.group) }}</h2>
        <div class="space-y-4">
          <div v-for="f in sec.fields" :key="f.key">
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-300">{{ t(f.label) }}</label>
            <p v-if="f.hint" class="mb-1 text-xs text-surface-400">{{ t(f.hint) }}</p>
            <textarea
              v-model="(form[f.key] as string)"
              :disabled="!canEdit"
              rows="3"
              class="mt-1 w-full rounded-md border border-surface-200 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-surface-700 dark:bg-surface-800"
            />
          </div>
        </div>
      </section>

      <!-- Save bar -->
      <div v-if="canEdit" class="flex items-center justify-end gap-3">
        <span v-if="savedFlash" class="inline-flex items-center gap-1 text-sm text-success-600">
          <Check class="size-4" /> {{ t('dashboard.jobs.brief.saved') }}
        </span>
        <UiButton
          type="button"
          :disabled="isSaving"
          :loading="isSaving"
          @click="onSave"
        >
          {{ t('dashboard.jobs.brief.save') }}
        </UiButton>
      </div>
    </div>
  </div>
</template>
