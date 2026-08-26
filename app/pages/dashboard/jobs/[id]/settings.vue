<script setup lang="ts">
import {
  Save, Trash2, ArrowLeft, ExternalLink, Link2, ClipboardCopy, RefreshCw,
} from 'lucide-vue-next'

const { t } = useI18n()
import { z } from 'zod'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const localePath = useLocalePath()
const jobId = route.params.id as string
const toast = useToast()
const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const { track } = useTrack()

const { job, status: fetchStatus, error: fetchError, updateJob, deleteJob } = useJob(jobId)

useSeoMeta({
  title: computed(() =>
    job.value ? `Настройки — ${job.value.title}` : 'Настройки вакансии',
  ),
})

// ─────────────────────────────────────────────
// Form state — synced from fetched job
// ─────────────────────────────────────────────

const form = ref({
  title: '',
  description: '',
  location: '',
  type: 'full_time' as string,
  slug: '',
  salaryMin: null as number | null,
  salaryMax: null as number | null,
  salaryCurrency: '',
  salaryUnit: '' as string,
  salaryNegotiable: false,
  remoteStatus: '' as string,
  experienceLevel: '' as string,
  validThrough: '',
  requireResume: false,
  requireCoverLetter: false,
  autoScoreOnApply: false,
  // Авто-отклонение по AI-скору
  autoRejectEnabled: false,
  autoRejectBelowScore: null as number | null,
  autoRejectReasonNote: '',
  // Авто-передвижение на «На рассмотрении» по AI-скору
  autoAdvanceEnabled: false,
  autoAdvanceAboveScore: null as number | null,
  autoAdvanceReasonNote: '',
  pipelineId: null as string | null,
})

watch(job, (j) => {
  if (j) {
    form.value = {
      title: j.title ?? '',
      description: j.description ?? '',
      location: j.location ?? '',
      type: j.type ?? 'full_time',
      slug: j.slug ?? '',
      salaryMin: j.salaryMin ?? null,
      salaryMax: j.salaryMax ?? null,
      salaryCurrency: j.salaryCurrency ?? '',
      salaryUnit: j.salaryUnit ?? '',
      salaryNegotiable: j.salaryNegotiable ?? false,
      remoteStatus: j.remoteStatus ?? '',
      experienceLevel: j.experienceLevel ?? '',
      validThrough: j.validThrough ? new Date(j.validThrough).toISOString().split('T')[0] ?? '' : '',
      requireResume: j.requireResume ?? false,
      requireCoverLetter: j.requireCoverLetter ?? false,
      autoScoreOnApply: j.autoScoreOnApply ?? false,
      autoRejectEnabled: (j as any).autoRejectEnabled ?? false,
      autoRejectBelowScore: (j as any).autoRejectBelowScore ?? null,
      autoRejectReasonNote: (j as any).autoRejectReasonNote ?? '',
      autoAdvanceEnabled: (j as any).autoAdvanceEnabled ?? false,
      autoAdvanceAboveScore: (j as any).autoAdvanceAboveScore ?? null,
      autoAdvanceReasonNote: (j as any).autoAdvanceReasonNote ?? '',
      pipelineId: (j as any).pipelineId ?? null,
    }
  }
}, { immediate: true })

// ─────────────────────────────────────────────
// Pipeline selector state
// ─────────────────────────────────────────────

// Fetch all non-archived pipelines for the org
const { data: pipelinesData } = useFetch('/api/pipelines', {
  query: { includeArchived: false },
  headers: useRequestHeaders(['cookie']),
})
const pipelines = computed(() => pipelinesData.value ?? [])

// Fetch pipeline-status for this job (lightweight — tells us if change is allowed)
const { data: pipelineStatus, refresh: refreshPipelineStatus } = useFetch(
  () => `/api/jobs/${jobId}/pipeline-status`,
  {
    key: computed(() => `pipeline-status-${jobId}`),
    headers: useRequestHeaders(['cookie']),
  },
)

const canChangePipeline = computed(() => pipelineStatus.value?.canChangePipeline ?? true)
const activeApplicationsCount = computed(() => pipelineStatus.value?.activeApplicationsCount ?? 0)

// ─────────────────────────────────────────────
// Спринт 12.2: синхронизация с hh.ru — тумблеры pull/push
// ─────────────────────────────────────────────

interface HhLinkInfo {
  id: string
  hhVacancyId: string
  hhVacancyUrl: string | null
  hhVacancyTitle: string | null
  lastSyncAt: string | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  importedCount: number
  autoSyncEnabled: boolean
  pushSyncEnabled: boolean
  /** Спринт 13.5: последний пуш этапа на hh.ru (из hh_action_log) */
  lastPush?: {
    createdAt: string
    targetCollection: string | null
    responseStatus: number | null
    error: string | null
  } | null
}

const hhLink = ref<HhLinkInfo | null>(null)

async function loadHhLink() {
  try {
    const res = await $fetch<{ linked: boolean, link?: HhLinkInfo }>(`/api/jobs/${jobId}/hh-link`)
    hhLink.value = res.linked && res.link ? res.link : null
  }
  catch {
    hhLink.value = null
  }
}
onMounted(loadHhLink)

const hhToggleBusy = ref(false)
async function toggleHhSync(field: 'pushSyncEnabled' | 'autoSyncEnabled') {
  if (!hhLink.value || hhToggleBusy.value) return
  const next = !hhLink.value[field]
  hhToggleBusy.value = true
  try {
    await $fetch(`/api/hh-vacancy-links/${hhLink.value.id}`, {
      method: 'PATCH',
      body: { [field]: next },
    })
    hhLink.value = { ...hhLink.value, [field]: next }
    if (field === 'pushSyncEnabled') {
      toast.success(next ? 'Пуш этапов на hh.ru включён' : 'Пуш этапов на hh.ru выключен')
    }
    else {
      toast.success(next ? 'Автоимпорт откликов включён' : 'Автоимпорт откликов выключен')
    }
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Не удалось обновить настройки синхронизации')
  }
  finally {
    hhToggleBusy.value = false
  }
}

// ─────────────────────────────────────────────
// Спринт 13.5: таблица «этап → коллекция hh.ru» + диагностика пуша
// ─────────────────────────────────────────────

interface PipelineViewStage {
  id: string
  name: string
  type: string
  color?: string | null
  displayOrder: number
  parentStageId?: string | null
  isHidden?: boolean | null
  isArchived?: boolean | null
}

const pipelineViewStages = ref<PipelineViewStage[]>([])
async function loadPipelineViewStages() {
  try {
    const res = await $fetch<{ stages?: PipelineViewStage[] }>(`/api/jobs/${jobId}/pipeline-view`)
    pipelineViewStages.value = res.stages ?? []
  }
  catch {
    pipelineViewStages.value = []
  }
}
onMounted(loadPipelineViewStages)

/** Зеркало серверного fallback-маппинга stageTypeToHhCollection (pushAction.ts). */
const STAGE_TYPE_TO_HH: Record<string, string | null> = {
  new: null,
  applied: null,
  on_hold: 'consider',
  screening: 'consider',
  contact: 'phone_interview',
  assessment: 'assessment',
  interview: 'interview',
  offer: 'offer',
  hired: 'hired',
  rejected: 'discard_by_employer',
  not_fit: 'discard_by_employer',
  withdrawn: 'discard_by_employer',
  no_show: 'discard_by_employer',
  job_closed: 'discard_by_employer',
  transferred: 'discard_by_employer',
}

const HH_COLLECTION_LABELS: Record<string, string> = {
  response: 'Отклики',
  consider: 'Подумать',
  phone_interview: 'Телефонное интервью',
  assessment: 'Оценка',
  interview: 'Интервью',
  offer: 'Оффер',
  hired: 'Выход на работу',
  discard_by_employer: 'Отказ работодателя',
  discard_after_interview: 'Отказ после интервью',
  discard_visible_by_opponent: 'Отказ (виден кандидату)',
}

const showHhMapping = ref(false)

const hhMappingRows = computed(() => pipelineViewStages.value
  .filter(s => !s.parentStageId && !s.isHidden && !s.isArchived)
  .sort((a, b) => a.displayOrder - b.displayOrder)
  .map((s) => {
    const coll = STAGE_TYPE_TO_HH[s.type] ?? null
    return {
      id: s.id,
      name: s.name,
      color: s.color ?? '#94a3b8',
      collection: coll,
      collectionLabel: coll ? (HH_COLLECTION_LABELS[coll] ?? coll) : 'Не переносится',
    }
  }))

function formatHhDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Переводит сырой текст ошибки hh.ru в понятное русскоязычное сообщение.
 * Ожидает JSON вида {"errors":[{"value":"invalid_vacancy","type":"negotiations"}]}
 * — если код известен, возвращает человеческую фразу, иначе — исходный текст.
 */
function humanizeHhError(raw: string | null | undefined): string {
  if (!raw) return ''
  const mapping: Record<string, string> = {
    invalid_vacancy: 'Вакансия на hh.ru закрыта, архивирована или больше не принадлежит работодателю. Перенос этапов на hh.ru невозможен.',
    not_found: 'Отклик не найден на hh.ru (возможно, был удалён).',
    negotiations_forbidden: 'Нет прав двигать отклики: токен hh.ru не назначен менеджером этой вакансии.',
    conflict_state: 'Отклик уже находится в целевом этапе на hh.ru.',
    already_in_state: 'Отклик уже находится в целевом этапе на hh.ru.',
    rate_limited: 'Превышен лимит запросов hh.ru. Следующий перенос будет выполнен позже.',
  }
  // Проверяем все коды: строка может содержать raw JSON, только код или смешанный текст.
  for (const [code, message] of Object.entries(mapping)) {
    if (raw.includes(code)) return message
  }
  return raw
}

// When "Negotiable" is toggled on, clear the salary range fields
watch(() => form.value.salaryNegotiable, (negotiable) => {
  if (negotiable) {
    form.value.salaryMin = null
    form.value.salaryMax = null
    form.value.salaryCurrency = ''
    form.value.salaryUnit = ''
  }
})

// ─────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────

const editSchema = z.object({
  title: z.string().min(1, 'Укажите название вакансии').max(200),
  description: z.string().optional(),
  location: z.string().optional(),
  type: z.enum(['full_time', 'part_time', 'contract', 'internship']),
  slug: z.string().max(80).optional(),
  salaryMin: z.union([z.coerce.number().int().min(0), z.null()]).optional(),
  salaryMax: z.union([z.coerce.number().int().min(0), z.null()]).optional(),
  salaryCurrency: z.string().length(3).optional().or(z.literal('')),
  salaryUnit: z.enum(['YEAR', 'MONTH', 'HOUR']).optional().or(z.literal('')),
  salaryNegotiable: z.boolean().optional(),
  remoteStatus: z.enum(['remote', 'hybrid', 'onsite']).optional().or(z.literal('')),
  experienceLevel: z.enum(['junior', 'mid', 'senior', 'lead']).optional().or(z.literal('')),
  validThrough: z.string().optional(),
  requireResume: z.boolean().optional(),
  requireCoverLetter: z.boolean().optional(),
  autoScoreOnApply: z.boolean().optional(),
  autoRejectEnabled: z.boolean().optional(),
  autoRejectBelowScore: z.number().int().min(0).max(100).nullable().optional(),
  autoRejectReasonNote: z.string().max(500).optional(),
  autoAdvanceEnabled: z.boolean().optional(),
  autoAdvanceAboveScore: z.number().int().min(0).max(100).nullable().optional(),
  autoAdvanceReasonNote: z.string().max(500).optional(),
})

const errors = ref<Record<string, string>>({})
const isSaving = ref(false)
const saved = ref(false)

async function handleSave() {
  const result = editSchema.safeParse(form.value)
  if (!result.success) {
    errors.value = {}
    for (const issue of result.error.issues) {
      const field = issue.path[0]?.toString()
      if (field) errors.value[field] = issue.message
    }
    return
  }
  errors.value = {}
  isSaving.value = true

  try {
    const payload: Record<string, unknown> = {
      title: form.value.title,
      description: form.value.description || null,
      location: form.value.location || null,
      type: form.value.type,
      slug: form.value.slug || undefined,
      requireResume: form.value.requireResume,
      requireCoverLetter: form.value.requireCoverLetter,
      autoScoreOnApply: form.value.autoScoreOnApply,
      autoRejectEnabled: form.value.autoRejectEnabled,
      autoRejectBelowScore: form.value.autoRejectEnabled ? (form.value.autoRejectBelowScore ?? null) : null,
      autoRejectReasonNote: form.value.autoRejectReasonNote?.trim() ? form.value.autoRejectReasonNote.trim() : null,
      autoAdvanceEnabled: form.value.autoAdvanceEnabled,
      autoAdvanceAboveScore: form.value.autoAdvanceEnabled ? (form.value.autoAdvanceAboveScore ?? null) : null,
      autoAdvanceReasonNote: form.value.autoAdvanceReasonNote?.trim() ? form.value.autoAdvanceReasonNote.trim() : null,
      salaryNegotiable: form.value.salaryNegotiable,
      // Always send salary fields so cleared values write null to the DB
      salaryMin: form.value.salaryNegotiable ? null : (form.value.salaryMin ?? null),
      salaryMax: form.value.salaryNegotiable ? null : (form.value.salaryMax ?? null),
      salaryCurrency: form.value.salaryNegotiable ? null : (form.value.salaryCurrency || null),
      salaryUnit: form.value.salaryNegotiable ? null : (form.value.salaryUnit || null),
      remoteStatus: form.value.remoteStatus || null,
      experienceLevel: (form.value.experienceLevel as 'junior' | 'mid' | 'senior' | 'lead' | null) || null,
      // Send null when cleared so the DB column is set to NULL
      validThrough: form.value.validThrough ? new Date(form.value.validThrough) : null,
      // Only send pipelineId if it has changed (backend validates active applications)
      pipelineId: form.value.pipelineId ?? null,
    }

    await updateJob(payload as any)
    await refreshPipelineStatus()
    track('job_settings_saved', { job_id: jobId })
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error(t('dashboard.jobs.settings.failedToSave'), { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
  } finally {
    isSaving.value = false
  }
}

// ─────────────────────────────────────────────
// Application link
// ─────────────────────────────────────────────

const requestUrl = useRequestURL()
const applicationUrl = computed(() => {
  const base = `${requestUrl.protocol}//${requestUrl.host}`
  return `${base}/jobs/${job.value?.slug ?? jobId}/apply`
})

const linkCopied = ref(false)

async function copyApplicationLink() {
  try {
    await navigator.clipboard.writeText(applicationUrl.value)
    linkCopied.value = true
    setTimeout(() => { linkCopied.value = false }, 2000)
  } catch {
    toast.info(applicationUrl.value)
  }
}

// ─────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────

const showDeleteConfirm = ref(false)
const isDeleting = ref(false)

async function handleDelete() {
  isDeleting.value = true
  try {
    track('job_deleted', { job_id: jobId, source: 'settings' })
    await deleteJob()
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error(t('dashboard.jobs.settings.failedToDelete'), { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
    isDeleting.value = false
    showDeleteConfirm.value = false
  }
}

// ─────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────

const typeOptions = computed(() => [
  { value: 'full_time', label: t('dashboard.jobs.settings.typeFullTime') },
  { value: 'part_time', label: t('dashboard.jobs.settings.typePartTime') },
  { value: 'contract', label: t('dashboard.jobs.settings.typeContract') },
  { value: 'internship', label: t('dashboard.jobs.settings.typeInternship') },
])

const remoteOptions = computed(() => [
  { value: '', label: t('dashboard.jobs.settings.notSpecified') },
  { value: 'remote', label: t('dashboard.jobs.settings.remote') },
  { value: 'hybrid', label: t('dashboard.jobs.settings.hybrid') },
  { value: 'onsite', label: t('dashboard.jobs.settings.onsite') },
])

const experienceLevelOptions = computed(() => [
  { value: '', label: t('dashboard.jobs.settings.notSpecified') },
  { value: 'junior', label: t('dashboard.jobs.settings.levelJunior') },
  { value: 'mid', label: t('dashboard.jobs.settings.levelMid') },
  { value: 'senior', label: t('dashboard.jobs.settings.levelSenior') },
  { value: 'lead', label: t('dashboard.jobs.settings.levelLead') },
])

const salaryUnitOptions = computed(() => [
  { value: '', label: t('dashboard.jobs.settings.notSpecified') },
  { value: 'YEAR', label: t('dashboard.jobs.settings.perYear') },
  { value: 'MONTH', label: t('dashboard.jobs.settings.perMonth') },
  { value: 'HOUR', label: t('dashboard.jobs.settings.perHour') },
])

function onSalaryMinChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.value) form.value.salaryMin = null
}

function onSalaryMaxChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.value) form.value.salaryMax = null
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <JobSubNavActions :job-id="jobId" />

    <!-- Loading -->
    <div v-if="fetchStatus === 'pending'" class="text-center py-12 text-surface-400">
      {{ $t('dashboard.jobs.settings.loading') }}
    </div>

    <!-- Error -->
    <div
      v-else-if="fetchError"
      class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-4 text-sm text-danger-700 dark:text-danger-400"
    >
      {{ fetchError.statusCode === 404 ? $t('dashboard.jobs.settings.jobNotFound') : $t('dashboard.jobs.settings.failedToLoad') }}
      <NuxtLink :to="$localePath('/dashboard/jobs')" class="underline ml-1">{{ $t('dashboard.jobs.settings.backToJobs') }}</NuxtLink>
    </div>

    <template v-else-if="job">
      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">{{ $t('dashboard.jobs.settings.pageTitle') }}</h1>
        <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">
          Измените данные вакансии <strong>{{ job.title }}</strong>.
        </p>
      </div>

      <form @submit.prevent="handleSave" class="space-y-8">
        <!-- ═══════════════════════════════════════ -->
        <!-- SECTION: Basic Details                   -->
        <!-- ═══════════════════════════════════════ -->
        <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100 mb-5">{{ $t('dashboard.jobs.settings.basicDetails') }}</h2>
          <div class="space-y-4">
            <!-- Title -->
            <div>
              <label for="settings-title" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ $t('dashboard.jobs.settings.labelTitle') }} <span class="text-danger-500">*</span>
              </label>
              <input
                id="settings-title"
                v-model="form.title"
                type="text"
                class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                :class="errors.title ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
              />
              <p v-if="errors.title" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.title }}</p>
            </div>

            <!-- Description -->
            <div>
              <label for="settings-description" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ $t('dashboard.jobs.settings.labelDescription') }}
              </label>
              <textarea
                id="settings-description"
                v-model="form.description"
                rows="6"
                placeholder="Опишите роль, обязанности и требования…"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              />
            </div>

            <!-- Location + Type row -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="settings-location" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  {{ $t('dashboard.jobs.settings.labelLocation') }}
                </label>
                <input
                  id="settings-location"
                  v-model="form.location"
                  type="text"
                  placeholder="Например, Москва"
                  class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                />
              </div>
              <div>
                <label for="settings-type" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  {{ $t('dashboard.jobs.settings.labelEmploymentType') }}
                </label>
                <select
                  id="settings-type"
                  v-model="form.type"
                  class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                >
                  <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
              </div>
            </div>

            <!-- Remote status -->
            <div>
              <label for="settings-remote" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ $t('dashboard.jobs.settings.labelWorkArrangement') }}
              </label>
              <select
                id="settings-remote"
                v-model="form.remoteStatus"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              >
                <option v-for="opt in remoteOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <!-- Experience Level -->
            <div>
              <label for="settings-experience-level" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ $t('dashboard.jobs.settings.labelExperienceLevel') }}
              </label>
              <select
                id="settings-experience-level"
                v-model="form.experienceLevel"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              >
                <option v-for="opt in experienceLevelOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <!-- Slug -->
            <div>
              <label for="settings-slug" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ $t('dashboard.jobs.settings.labelSlug') }}
              </label>
              <input
                id="settings-slug"
                v-model="form.slug"
                type="text"
                placeholder="создаётся-автоматически-из-названия"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors font-mono text-xs"
              />
              <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">
                Используется в публичном URL отклика. Оставьте пустым, чтобы создать автоматически из названия.
              </p>
            </div>
          </div>
        </section>

        <!-- ═══════════════════════════════════════ -->
        <!-- SECTION: Salary & Compensation           -->
        <!-- ═══════════════════════════════════════ -->
        <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.settings.salarySection') }}</h2>
          <p class="text-xs text-surface-400 dark:text-surface-500 mb-5">
            Добавление информации о зарплате повышает видимость в Google Jobs.
          </p>
          <div class="space-y-4">
            <!-- Negotiable toggle -->
            <label class="flex items-center gap-3 cursor-pointer">
              <input
                v-model="form.salaryNegotiable"
                type="checkbox"
                class="size-4 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500"
              />
              <div>
                <span class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.settings.salaryNegotiable') }}</span>
                <p class="text-xs text-surface-400 dark:text-surface-500">
                  Если включено, вместо диапазона зарплаты будет показано «По договорённости». Поля ниже будут очищены.
                </p>
              </div>
            </label>

            <!-- Salary range fields — hidden when negotiable -->
            <template v-if="!form.salaryNegotiable">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="settings-salary-min" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    {{ $t('dashboard.jobs.settings.salaryMin') }}
                  </label>
                  <input
                    id="settings-salary-min"
                    v-model.number="form.salaryMin"
                    type="number"
                    min="0"
                    placeholder="Например, 50 000"
                    class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    @change="onSalaryMinChange"
                  />
                </div>
                <div>
                  <label for="settings-salary-max" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    {{ $t('dashboard.jobs.settings.salaryMax') }}
                  </label>
                  <input
                    id="settings-salary-max"
                    v-model.number="form.salaryMax"
                    type="number"
                    min="0"
                    placeholder="Например, 80 000"
                    class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    @change="onSalaryMaxChange"
                  />
                </div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="settings-currency" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    {{ $t('dashboard.jobs.settings.salaryCurrency') }}
                  </label>
                  <input
                    id="settings-currency"
                    v-model="form.salaryCurrency"
                    type="text"
                    maxlength="3"
                    placeholder="Например, USD, EUR, RUB"
                    class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors uppercase"
                  />
                </div>
                <div>
                  <label for="settings-salary-unit" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    {{ $t('dashboard.jobs.settings.salaryPeriod') }}
                  </label>
                  <select
                    id="settings-salary-unit"
                    v-model="form.salaryUnit"
                    class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  >
                    <option v-for="opt in salaryUnitOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                </div>
              </div>
            </template>
          </div>
        </section>

        <!-- ═══════════════════════════════════════ -->
        <!-- SECTION: Hiring Pipeline                 -->
        <!-- ═══════════════════════════════════════ -->
        <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.form.pipelineLabel') }}</h2>
          <p class="text-xs text-surface-400 dark:text-surface-500 mb-5">{{ t('dashboard.jobs.form.pipelineHelp') }}</p>

          <!-- Warning banner: pipeline locked due to active candidates -->
          <div
            v-if="!canChangePipeline"
            class="mb-4 rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950/30 px-4 py-3 text-sm text-danger-700 dark:text-danger-300"
          >
            {{ t('dashboard.jobs.form.pipelineLocked', { count: activeApplicationsCount }) }}
          </div>

          <div>
            <label for="settings-pipelineId" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
              {{ t('dashboard.jobs.form.pipelineLabel') }}
            </label>
            <select
              id="settings-pipelineId"
              v-model="form.pipelineId"
              :disabled="!canChangePipeline"
              class="w-full rounded-lg border px-3 py-2.5 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 border-surface-300 dark:border-surface-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option :value="null" disabled>{{ t('dashboard.jobs.form.pipelinePlaceholder') }}</option>
              <option v-for="p in pipelines" :key="(p as any).id" :value="(p as any).id">
                {{ (p as any).name }}{{ (p as any).isSystem ? ` ${t('dashboard.jobs.form.pipelineSystemSuffix')}` : (p as any).isDefault ? ` ${t('dashboard.jobs.form.pipelineDefaultSuffix')}` : '' }}
              </option>
            </select>
          </div>
        </section>

        <!-- ═══════════════════════════════════════ -->
        <!-- SECTION: Per-vacancy Pipeline Customize -->
        <!-- ═══════════════════════════════════════ -->
        <JobPipelineCustomize
          v-if="jobId && form.pipelineId"
          :job-id="jobId"
        />

        <!-- ═══════════════════════════════════════ -->
        <!-- SECTION: Recruiters (Sprint 20)         -->
        <!-- ═══════════════════════════════════════ -->
        <JobRecruitersSection
          v-if="jobId"
          :job-id="jobId"
        />

        <!-- ═══════════════════════════════════════ -->
        <!-- SECTION: Hiring Managers (Sprint 20)    -->
        <!-- ═══════════════════════════════════════ -->
        <JobHiringManagersSection
          v-if="jobId"
          :job-id="jobId"
        />

        <!-- ═══════════════════════════════════════ -->
        <!-- SECTION: Automation                     -->
        <!-- ═══════════════════════════════════════ -->
        <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.settings.automationSection') }}</h2>
          <p class="text-xs text-surface-400 dark:text-surface-500 mb-5">{{ $t('dashboard.jobs.settings.automationSectionHint') }}</p>
          <div class="space-y-3">
            <!-- Автооценка при отклике -->
            <label class="flex items-center gap-3 cursor-pointer">
              <input
                v-model="form.autoScoreOnApply"
                type="checkbox"
                class="size-4 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500"
              />
              <div>
                <span class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.settings.autoScore') }}</span>
                <p class="text-xs text-surface-400 dark:text-surface-500">{{ $t('dashboard.jobs.settings.autoScoreHint') }}</p>
              </div>
            </label>

            <!-- Авто-отклонение по AI-скору -->
            <div class="pt-3 mt-1 border-t border-surface-100 dark:border-surface-800">
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  v-model="form.autoRejectEnabled"
                  type="checkbox"
                  class="size-4 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500"
                />
                <div>
                  <span class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.settings.autoReject') }}</span>
                  <p class="text-xs text-surface-400 dark:text-surface-500">{{ $t('dashboard.jobs.settings.autoRejectHint') }}</p>
                </div>
              </label>

              <div
                v-if="form.autoRejectEnabled"
                class="mt-4 ml-7 space-y-4 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50/60 dark:bg-surface-900/40 p-4"
              >
                <!-- Порог -->
                <div>
                  <label for="settings-auto-reject-threshold" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    {{ $t('dashboard.jobs.settings.autoRejectThreshold') }}
                  </label>
                  <div class="flex items-center gap-2">
                    <input
                      id="settings-auto-reject-threshold"
                      v-model.number="form.autoRejectBelowScore"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      placeholder="50"
                      class="w-28 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    />
                    <span class="text-sm text-surface-500 dark:text-surface-400">{{ $t('dashboard.jobs.settings.autoRejectThresholdSuffix') }}</span>
                  </div>
                  <p class="mt-1.5 text-xs text-surface-400 dark:text-surface-500">
                    {{ $t('dashboard.jobs.settings.autoRejectThresholdHint') }}
                  </p>
                </div>

                <!-- Причина (опционально) -->
                <div>
                  <label for="settings-auto-reject-note" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    {{ $t('dashboard.jobs.settings.autoRejectNote') }}
                  </label>
                  <textarea
                    id="settings-auto-reject-note"
                    v-model="form.autoRejectReasonNote"
                    rows="2"
                    maxlength="500"
                    :placeholder="$t('dashboard.jobs.settings.autoRejectNotePlaceholder')"
                    class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors resize-y"
                  />
                  <p class="mt-1.5 text-xs text-surface-400 dark:text-surface-500">
                    {{ $t('dashboard.jobs.settings.autoRejectNoteHint') }}
                  </p>
                </div>

                <!-- Инфо о защитах -->
                <div class="rounded-md bg-warning-50 dark:bg-warning-950/40 border border-warning-200 dark:border-warning-900 px-3 py-2.5 text-xs text-warning-800 dark:text-warning-200">
                  <div class="font-medium mb-1">{{ $t('dashboard.jobs.settings.autoRejectSafetyTitle') }}</div>
                  <ul class="list-disc list-inside space-y-0.5 leading-relaxed">
                    <li>{{ $t('dashboard.jobs.settings.autoRejectSafety1') }}</li>
                    <li>{{ $t('dashboard.jobs.settings.autoRejectSafety2') }}</li>
                    <li>{{ $t('dashboard.jobs.settings.autoRejectSafety3') }}</li>
                    <li>{{ $t('dashboard.jobs.settings.autoRejectSafety4') }}</li>
                  </ul>
                </div>
              </div>
            </div>

            <!-- Авто-передвижение на «На рассмотрении» по AI-скору -->
            <div class="pt-3 mt-1 border-t border-surface-100 dark:border-surface-800">
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  v-model="form.autoAdvanceEnabled"
                  type="checkbox"
                  class="size-4 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500"
                />
                <div>
                  <span class="text-sm font-medium text-surface-900 dark:text-surface-100">Авто-передвижение на «На рассмотрении»</span>
                  <p class="text-xs text-surface-400 dark:text-surface-500">Если AI-скор кандидата не ниже порога — отклик автоматически уйдёт в очередь НМ.</p>
                </div>
              </label>

              <div
                v-if="form.autoAdvanceEnabled"
                class="mt-4 ml-7 space-y-4 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50/60 dark:bg-surface-900/40 p-4"
              >
                <!-- Порог -->
                <div>
                  <label for="settings-auto-advance-threshold" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    Порог авто-передвижения
                  </label>
                  <div class="flex items-center gap-2">
                    <input
                      id="settings-auto-advance-threshold"
                      v-model.number="form.autoAdvanceAboveScore"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      placeholder="80"
                      class="w-28 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    />
                    <span class="text-sm text-surface-500 dark:text-surface-400">баллов и выше</span>
                  </div>
                  <p class="mt-1.5 text-xs text-surface-400 dark:text-surface-500">
                    Кандидаты с AI-скором не ниже этого порога будут автоматически уходить на подэтап «На рассмотрении».
                  </p>
                </div>

                <!-- Комментарий (опционально) -->
                <div>
                  <label for="settings-auto-advance-note" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    Комментарий к авто-передвижению
                  </label>
                  <textarea
                    id="settings-auto-advance-note"
                    v-model="form.autoAdvanceReasonNote"
                    rows="2"
                    maxlength="500"
                    placeholder="Например: «Сильный матч по AI — сразу НМ»"
                    class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors resize-y"
                  />
                  <p class="mt-1.5 text-xs text-surface-400 dark:text-surface-500">
                    Попадёт в историю этапов вместе с технической причиной «Авто-передвижение по AI-скору…».
                  </p>
                </div>

                <!-- Инфо о защитах -->
                <div class="rounded-md bg-info-50 dark:bg-info-950/40 border border-info-200 dark:border-info-900 px-3 py-2.5 text-xs text-info-800 dark:text-info-200">
                  <div class="font-medium mb-1">Правило НЕ сработает, если:</div>
                  <ul class="list-disc list-inside space-y-0.5 leading-relaxed">
                    <li>сработало авто-отклонение выше (отказ важнее);</li>
                    <li>рекрутёр уже перемещал отклик по воронке;</li>
                    <li>кандидат помечен «только вручную»;</li>
                    <li>AI-уверенность ниже 50%;</li>
                    <li>в воронке нет подэтапа «На рассмотрении» (напр. не назначен НМ).</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════════════════════════ -->
        <!-- SECTION: hh.ru Sync (Спринт 12.2)        -->
        <!-- ═══════════════════════════════════════ -->
        <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6">
          <div class="flex items-center gap-2 mb-1">
            <RefreshCw class="size-4 text-red-500" />
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Синхронизация с hh.ru</h2>
          </div>
          <!-- Спринт 13.1: заглушка, когда вакансия не связана с hh.ru -->
          <div v-if="!hhLink" class="rounded-md bg-surface-50 dark:bg-surface-950/40 border border-dashed border-surface-300 dark:border-surface-700 px-4 py-5 text-sm text-surface-500 dark:text-surface-400">
            Вакансия пока не связана с hh.ru. Свяжите её с вакансией на hh.ru через импорт откликов
            (Сорсинг → Импорт с hh.ru) — после этого здесь появятся настройки автоимпорта откликов
            и переноса этапов на hh.ru.
          </div>
          <template v-else>
          <p class="text-xs text-surface-400 dark:text-surface-500 mb-5">
            Вакансия связана с
            <a
              v-if="hhLink.hhVacancyUrl"
              :href="hhLink.hhVacancyUrl"
              target="_blank"
              rel="noopener"
              class="text-brand-600 hover:underline dark:text-brand-400"
            >{{ hhLink.hhVacancyTitle || `вакансией №${hhLink.hhVacancyId}` }}</a>
            <span v-else>вакансией №{{ hhLink.hhVacancyId }}</span>
            · импортировано откликов: {{ hhLink.importedCount }}
          </p>
          <div class="space-y-3">
            <!-- Пуш этапов на hh.ru -->
            <label class="flex items-center gap-3 cursor-pointer" :class="{ 'opacity-60': hhToggleBusy }">
              <input
                type="checkbox"
                :checked="hhLink.pushSyncEnabled"
                :disabled="hhToggleBusy"
                class="size-4 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500"
                @change="toggleHhSync('pushSyncEnabled')"
              />
              <div>
                <span class="text-sm font-medium text-surface-900 dark:text-surface-100">Переносить этапы на hh.ru</span>
                <p class="text-xs text-surface-400 dark:text-surface-500">При смене этапа кандидата в системе отклик автоматически перемещается в соответствующую коллекцию на hh.ru (Подумать, Интервью, Отказ и т.д.)</p>
              </div>
            </label>
            <!-- Автоимпорт откликов -->
            <label class="flex items-center gap-3 cursor-pointer pt-3 mt-1 border-t border-surface-100 dark:border-surface-800" :class="{ 'opacity-60': hhToggleBusy }">
              <input
                type="checkbox"
                :checked="hhLink.autoSyncEnabled"
                :disabled="hhToggleBusy"
                class="size-4 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500"
                @change="toggleHhSync('autoSyncEnabled')"
              />
              <div>
                <span class="text-sm font-medium text-surface-900 dark:text-surface-100">Автоимпорт откликов с hh.ru</span>
                <p class="text-xs text-surface-400 dark:text-surface-500">Периодически забирать новые отклики и изменения коллекций с hh.ru в систему</p>
              </div>
            </label>
            <!-- Правило воронок -->
            <div class="rounded-md bg-surface-50 dark:bg-surface-950/40 border border-surface-200 dark:border-surface-800 px-3 py-2.5 text-xs text-surface-600 dark:text-surface-300">
              <span class="font-medium">Правило:</span> при включённой синхронизации воронка на hh.ru считается равной воронке в системе. Система — источник истины: этап определяет коллекцию на hh.ru по типу этапа, даже если названия этапов отличаются.
            </div>

            <!-- Спринт 13.5: диагностика синхронизации -->
            <div class="rounded-md border border-surface-200 dark:border-surface-800 px-3 py-2.5 text-xs space-y-1.5">
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span class="text-surface-400">Последний импорт:</span>
                <span class="font-medium text-surface-700 dark:text-surface-200">{{ formatHhDate(hhLink.lastSyncAt) }}</span>
                <span
                  v-if="hhLink.lastSyncStatus"
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                  :class="hhLink.lastSyncStatus === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400'"
                >{{ hhLink.lastSyncStatus === 'ok' ? 'успешно' : 'ошибка' }}</span>
              </div>
              <p v-if="hhLink.lastSyncError" class="text-red-600 dark:text-red-400 break-all">{{ humanizeHhError(hhLink.lastSyncError) }}</p>
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 border-t border-surface-100 dark:border-surface-800">
                <span class="text-surface-400">Последний пуш этапа:</span>
                <template v-if="hhLink.lastPush">
                  <span class="font-medium text-surface-700 dark:text-surface-200">{{ formatHhDate(hhLink.lastPush.createdAt) }}</span>
                  <span v-if="hhLink.lastPush.targetCollection" class="text-surface-500 dark:text-surface-400">→ {{ HH_COLLECTION_LABELS[hhLink.lastPush.targetCollection] ?? hhLink.lastPush.targetCollection }}</span>
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="!hhLink.lastPush.error ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400'"
                  >{{ !hhLink.lastPush.error ? `успешно (${hhLink.lastPush.responseStatus ?? '—'})` : `ошибка (${hhLink.lastPush.responseStatus ?? '—'})` }}</span>
                </template>
                <span v-else class="text-surface-400">ещё не выполнялся</span>
              </div>
              <p v-if="hhLink.lastPush?.error" class="text-red-600 dark:text-red-400 break-all">{{ humanizeHhError(hhLink.lastPush.error) }}</p>
            </div>

            <!-- Спринт 13.5: таблица «этап → коллекция hh.ru» -->
            <div>
              <button
                type="button"
                class="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline cursor-pointer"
                @click="showHhMapping = !showHhMapping"
              >
                {{ showHhMapping ? 'Скрыть' : 'Показать' }} соответствие этапов и коллекций hh.ru
              </button>
              <div v-if="showHhMapping" class="mt-2 overflow-hidden rounded-md border border-surface-200 dark:border-surface-800">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="bg-surface-50 dark:bg-surface-950/40 text-left text-surface-500 dark:text-surface-400">
                      <th class="px-3 py-2 font-medium">Этап в системе</th>
                      <th class="px-3 py-2 font-medium">Коллекция на hh.ru</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in hhMappingRows"
                      :key="row.id"
                      class="border-t border-surface-100 dark:border-surface-800"
                    >
                      <td class="px-3 py-1.5">
                        <span class="inline-flex items-center gap-2 text-surface-700 dark:text-surface-200">
                          <span class="inline-flex size-2 shrink-0 rounded-full" :style="{ backgroundColor: row.color }" />
                          {{ row.name }}
                        </span>
                      </td>
                      <td class="px-3 py-1.5" :class="row.collection ? 'text-surface-700 dark:text-surface-200' : 'text-surface-400 dark:text-surface-500'">
                        {{ row.collectionLabel }}
                      </td>
                    </tr>
                    <tr v-if="!hhMappingRows.length" class="border-t border-surface-100 dark:border-surface-800">
                      <td colspan="2" class="px-3 py-2 text-surface-400">У вакансии нет воронки с этапами</td>
                    </tr>
                  </tbody>
                </table>
                <p class="border-t border-surface-100 dark:border-surface-800 bg-surface-50 dark:bg-surface-950/40 px-3 py-2 text-[11px] text-surface-400 dark:text-surface-500">
                  Если коллекция недоступна на hh.ru (тариф или состояние отклика), система автоматически подберёт ближайшую доступную.
                </p>
              </div>
            </div>
          </div>
          </template>
        </section>

        <!-- ═══════════════════════════════════════ -->
        <!-- SECTION: Application Options             -->
        <!-- ═══════════════════════════════════════ -->
        <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.settings.appOptionsSection') }}</h2>
          <p class="text-xs text-surface-400 dark:text-surface-500 mb-5">
            {{ $t('dashboard.jobs.settings.appOptionsSectionHint') }}
          </p>
          <div class="space-y-3">
            <label class="flex items-center gap-3 cursor-pointer">
              <input
                v-model="form.requireResume"
                type="checkbox"
                class="size-4 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500"
              />
              <div>
                <span class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.settings.requireResume') }}</span>
                <p class="text-xs text-surface-400 dark:text-surface-500">{{ $t('dashboard.jobs.settings.requireResumeHint') }}</p>
              </div>
            </label>
            <label class="flex items-center gap-3 cursor-pointer">
              <input
                v-model="form.requireCoverLetter"
                type="checkbox"
                class="size-4 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500"
              />
              <div>
                <span class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.settings.requireCoverLetter') }}</span>
                <p class="text-xs text-surface-400 dark:text-surface-500">{{ $t('dashboard.jobs.settings.requireCoverLetterHint') }}</p>
              </div>
            </label>
          </div>
        </section>

        <!-- ═══════════════════════════════════════ -->
        <!-- SECTION: Listing Expiry                  -->
        <!-- ═══════════════════════════════════════ -->
        <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.settings.listingExpiry') }}</h2>
          <p class="text-xs text-surface-400 dark:text-surface-500 mb-5">
            Укажите дату автоматического снятия вакансии с публикации. Это необходимо для расширенных результатов Google Jobs.
          </p>
          <div>
            <label for="settings-valid-through" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ $t('dashboard.jobs.settings.validThrough') }}
            </label>
            <div class="flex items-center gap-2">
              <input
                id="settings-valid-through"
                v-model="form.validThrough"
                type="date"
                class="w-full sm:w-64 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              />
              <button
                v-if="form.validThrough"
                type="button"
                class="text-xs text-surface-400 hover:text-danger-500 dark:hover:text-danger-400 transition-colors underline shrink-0"
                @click="form.validThrough = ''"
              >
                {{ $t('dashboard.jobs.settings.clear') }}
              </button>
            </div>
            <p class="mt-1.5 text-xs text-surface-400 dark:text-surface-500">Оставьте пустым, если фиксированной даты окончания нет.</p>
          </div>
        </section>

        <!-- ═══════════════════════════════════════ -->
        <!-- SECTION: Application Link                -->
        <!-- ═══════════════════════════════════════ -->
        <section v-if="job.status === 'open'" class="rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-950/30 p-6">
          <div class="flex items-center gap-2 mb-2">
            <Link2 class="size-4 text-brand-600 dark:text-brand-400" />
            <h2 class="text-base font-semibold text-brand-700 dark:text-brand-300">{{ $t('dashboard.jobs.settings.applicationLink') }}</h2>
          </div>
          <p class="text-xs text-surface-600 dark:text-surface-400 mb-3">
            Поделитесь этой ссылкой с кандидатами, чтобы они могли откликнуться на вакансию.
          </p>
          <div class="flex items-center gap-2">
            <input
              type="text"
              readonly
              :value="applicationUrl"
              class="flex-1 rounded-lg border border-brand-200 dark:border-brand-800 bg-white dark:bg-surface-900 px-3 py-1.5 text-sm text-surface-700 dark:text-surface-300 select-all"
            />
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
              @click="copyApplicationLink"
            >
              <ClipboardCopy class="size-3.5" />
              {{ linkCopied ? $t('dashboard.jobs.settings.copied') : $t('dashboard.jobs.settings.copy') }}
            </button>
          </div>
        </section>

        <!-- ═══════════════════════════════════════ -->
        <!-- Save button                              -->
        <!-- ═══════════════════════════════════════ -->
        <div class="flex items-center justify-between pt-2 pb-8">
          <button
            type="submit"
            :disabled="isSaving"
            class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save class="size-4" />
            {{ saved ? $t('dashboard.jobs.settings.saved') : isSaving ? $t('dashboard.jobs.settings.saving') : $t('dashboard.jobs.settings.saveChanges') }}
          </button>
        </div>
      </form>

      <!-- ═══════════════════════════════════════ -->
      <!-- DANGER ZONE                              -->
      <!-- ═══════════════════════════════════════ -->
      <section class="rounded-xl border border-danger-200 dark:border-danger-800/60 bg-danger-50/50 dark:bg-danger-950/20 p-6 mb-12">
        <h2 class="text-base font-semibold text-danger-700 dark:text-danger-400 mb-1">{{ $t('dashboard.jobs.settings.dangerZone') }}</h2>
        <p class="text-xs text-surface-500 dark:text-surface-400 mb-4">
          Безвозвратно удалить вакансию и все связанные с ней отклики.
        </p>

        <div v-if="!showDeleteConfirm">
          <button
            type="button"
            class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-danger-300 dark:border-danger-700 px-4 py-2 text-sm font-medium text-danger-700 dark:text-danger-400 hover:bg-danger-100 dark:hover:bg-danger-950/40 transition-colors"
            @click="showDeleteConfirm = true"
          >
            <Trash2 class="size-4" />
            {{ $t('dashboard.jobs.settings.deleteThisJob') }}
          </button>
        </div>

        <div v-else class="rounded-lg border border-danger-300 dark:border-danger-700 bg-white dark:bg-surface-900 p-4">
          <p class="text-sm text-surface-700 dark:text-surface-300 mb-3">
            {{ $t('dashboard.jobs.settings.deleteConfirm') }}
          </p>
          <div class="flex items-center gap-2">
            <button
              type="button"
              :disabled="isDeleting"
              class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-danger-600 px-4 py-2 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              @click="handleDelete"
            >
              {{ isDeleting ? $t('dashboard.jobs.settings.deleting') : $t('dashboard.jobs.settings.confirmDelete') }}
            </button>
            <button
              type="button"
              :disabled="isDeleting"
              class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              @click="showDeleteConfirm = false"
            >
              {{ $t('dashboard.jobs.settings.cancel') }}
            </button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
