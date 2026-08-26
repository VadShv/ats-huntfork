<script setup lang="ts">
import {
  Brain, Sparkles, SlidersHorizontal, Plus, Trash2, Loader2, Save, RotateCcw,
} from 'lucide-vue-next'
import { slugifyKeyRu, validateCriterionName } from '~/utils/criteriaKey'

const { t } = useI18n()

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const jobId = route.params.id as string
const toast = useToast()
const { track } = useTrack()

const { job, status: jobFetchStatus, error: jobError, updateJob } = useJob(jobId)

useSeoMeta({
  title: computed(() =>
    job.value ? `${t('dashboard.jobs.aiAnalysis.pageTitle')} — ${job.value.title}` : `${t('dashboard.jobs.aiAnalysis.pageTitle')}`,
  ),
  robots: 'noindex, nofollow',
})

// ─────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────

type ScoringCriterionDraft = {
  key: string
  name: string
  description: string
  category: 'technical' | 'experience' | 'soft_skills' | 'education' | 'culture' | 'custom'
  maxScore: number
  weight: number
}

const categoryLabels = computed<Record<string, string>>(() => ({
  technical: t('dashboard.jobs.aiAnalysis.categoryTechnical'),
  experience: t('dashboard.jobs.aiAnalysis.categoryExperience'),
  soft_skills: t('dashboard.jobs.aiAnalysis.categorySoftSkills'),
  education: t('dashboard.jobs.aiAnalysis.categoryEducation'),
  culture: t('dashboard.jobs.aiAnalysis.categoryCulture'),
  custom: t('dashboard.jobs.aiAnalysis.categoryCustom'),
}))

const categoryColorClasses: Record<string, string> = {
  technical: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-800',
  experience: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:ring-purple-800',
  soft_skills: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800',
  education: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800',
  culture: 'bg-pink-50 text-pink-700 ring-pink-200 dark:bg-pink-950/50 dark:text-pink-300 dark:ring-pink-800',
  custom: 'bg-surface-50 text-surface-700 ring-surface-200 dark:bg-surface-800/50 dark:text-surface-300 dark:ring-surface-700',
}

// ─────────────────────────────────────────────
// Fetch existing criteria
// ─────────────────────────────────────────────

const { data: criteriaData, status: criteriaFetchStatus, refresh: refreshCriteria } = useFetch(
  () => `/api/jobs/${jobId}/criteria`,
  {
    key: `job-criteria-${jobId}`,
    headers: useRequestHeaders(['cookie']),
  },
)

const scoringCriteria = ref<ScoringCriterionDraft[]>([])
const hasUnsavedChanges = ref(false)

// Sync fetched criteria into editable state
watch(criteriaData, (data) => {
  if (data?.criteria) {
    scoringCriteria.value = data.criteria.map((c: any) => ({
      key: c.key,
      name: c.name,
      description: c.description ?? '',
      category: c.category ?? 'custom',
      maxScore: c.maxScore ?? 10,
      weight: c.weight ?? 50,
    }))
    hasUnsavedChanges.value = false
  }
}, { immediate: true })

// Track changes
watch(scoringCriteria, () => {
  hasUnsavedChanges.value = true
}, { deep: true })

// ─────────────────────────────────────────────
// Auto-score toggle
// ─────────────────────────────────────────────

const autoScoreOnApply = ref(false)
const isSavingAutoScore = ref(false)

watch(job, (j) => {
  if (j) autoScoreOnApply.value = (j as any).autoScoreOnApply ?? false
}, { immediate: true })

async function toggleAutoScore() {
  isSavingAutoScore.value = true
  try {
    await $fetch(`/api/jobs/${jobId}`, {
      method: 'PATCH',
      body: { autoScoreOnApply: autoScoreOnApply.value },
    })
    toast.success(t('dashboard.jobs.aiAnalysis.autoScoreUpdated'))
  } catch (err: any) {
    toast.error(t('dashboard.jobs.aiAnalysis.failedToUpdateAutoScore'), { message: err?.data?.statusMessage })
    autoScoreOnApply.value = !autoScoreOnApply.value
  } finally {
    isSavingAutoScore.value = false
  }
}

// ─────────────────────────────────────────────
// Template loading
// ─────────────────────────────────────────────

const selectedTemplate = ref<'standard' | 'technical' | 'non_technical'>('standard')

const templates = computed<Record<string, ScoringCriterionDraft[]>>(() => ({
  standard: [
    { key: 'technical_skills', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameTechnicalSkills'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescTechnicalSkills'), category: 'technical', maxScore: 10, weight: 50 },
    { key: 'relevant_experience', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameRelevantExperience'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescRelevantExperience'), category: 'experience', maxScore: 10, weight: 50 },
    { key: 'education_fit', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameEducation'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescEducation'), category: 'education', maxScore: 10, weight: 30 },
  ],
  technical: [
    { key: 'core_tech_stack', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameCoreTechStack'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescCoreTechStack'), category: 'technical', maxScore: 10, weight: 70 },
    { key: 'system_design', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameSystemDesign'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescSystemDesign'), category: 'technical', maxScore: 10, weight: 50 },
    { key: 'engineering_practices', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameEngineeringPractices'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescEngineeringPractices'), category: 'technical', maxScore: 10, weight: 40 },
    { key: 'relevant_experience', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameRelevantExperience'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescRelevantExperience'), category: 'experience', maxScore: 10, weight: 50 },
    { key: 'leadership_collab', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameLeadership'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescLeadership'), category: 'soft_skills', maxScore: 10, weight: 30 },
  ],
  non_technical: [
    { key: 'relevant_experience', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameRelevantExperience'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescRelevantExperience'), category: 'experience', maxScore: 10, weight: 60 },
    { key: 'communication', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameCommunication'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescCommunication'), category: 'soft_skills', maxScore: 10, weight: 50 },
    { key: 'domain_knowledge', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameDomainKnowledge'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescDomainKnowledge'), category: 'experience', maxScore: 10, weight: 40 },
    { key: 'education_fit', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameEducation'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescEducation'), category: 'education', maxScore: 10, weight: 30 },
    { key: 'culture_fit', name: t('dashboard.jobs.aiAnalysis.templateCriteriaNameCultureFit'), description: t('dashboard.jobs.aiAnalysis.templateCriteriaDescCultureFit'), category: 'culture', maxScore: 10, weight: 30 },
  ],
}))

function loadTemplate(template: 'standard' | 'technical' | 'non_technical') {
  scoringCriteria.value = structuredClone(templates.value[template] ?? [])
}

// ─────────────────────────────────────────────
// AI generation
// ─────────────────────────────────────────────

const isGeneratingCriteria = ref(false)

async function generateAiCriteria() {
  if (!job.value?.description) {
    toast.warning(t('dashboard.jobs.aiAnalysis.descRequired'))
    return
  }
  isGeneratingCriteria.value = true
  try {
    const result = await $fetch('/api/ai-config/generate-criteria', {
      method: 'POST',
      body: {
        title: job.value.title,
        description: job.value.description,
      },
    })
    scoringCriteria.value = (result.criteria ?? []).map((c: any) => ({
      key: c.key,
      name: c.name,
      description: c.description ?? '',
      category: c.category ?? 'custom',
      maxScore: c.maxScore ?? 10,
      weight: c.weight ?? 50,
    }))
    track('ai_criteria_generated', { job_id: jobId, criteria_count: scoringCriteria.value.length })
    toast.success(t('dashboard.jobs.aiAnalysis.criteriaGenerated'), t('dashboard.jobs.aiAnalysis.criteriaGeneratedDesc', { n: scoringCriteria.value.length }))
  } catch (err: any) {
    const statusCode = err?.data?.statusCode ?? err?.statusCode
    const statusMessage = err?.data?.statusMessage ?? ''
    if (statusCode === 422 && statusMessage.includes('AI provider not configured')) {
      toast.add({
        type: 'warning',
        title: t('dashboard.jobs.aiAnalysis.aiNotConfigured'),
        message: t('dashboard.jobs.aiAnalysis.aiNotConfiguredDesc'),
        link: { label: t('dashboard.jobs.aiAnalysis.goToAiSettings'), href: '/dashboard/settings/ai' },
        duration: 10000,
      })
    } else {
      toast.error(t('dashboard.jobs.aiAnalysis.failedToGenerate'), { message: statusMessage })
    }
  } finally {
    isGeneratingCriteria.value = false
  }
}

// ─────────────────────────────────────────────
// Custom criterion form
// ─────────────────────────────────────────────

const showCustomForm = ref(false)
const customCriterionForm = ref({
  key: '',
  name: '',
  description: '',
  category: 'custom' as ScoringCriterionDraft['category'],
  maxScore: 10,
  weight: 50,
})

function addCustomCriterion() {
  const f = customCriterionForm.value
  const name = (f.name || '').trim()
  const v = validateCriterionName(name)
  if (!v.ok) {
    toast.warning(v.reason)
    return
  }

  const key = slugifyKeyRu(name, scoringCriteria.value.map(c => c.key))

  scoringCriteria.value.push({
    key,
    name,
    description: (f.description || '').trim(),
    category: f.category,
    maxScore: f.maxScore,
    weight: f.weight,
  })
  customCriterionForm.value = { key: '', name: '', description: '', category: 'custom', maxScore: 10, weight: 50 }
  showCustomForm.value = false
}

function removeCriterion(key: string) {
  scoringCriteria.value = scoringCriteria.value.filter(c => c.key !== key)
}

// ─────────────────────────────────────────────
// Save criteria (POST replaces all)
// ─────────────────────────────────────────────

const isSaving = ref(false)

// ─── Диалог пересчёта оценок после изменения критериев ───
const showRescoreDialog = ref(false)
const rescoreScoredCount = ref(0)
const rescoreTotalCount = ref(0)
const isRescoring = ref(false)

function snapshotKeys(criteria: ScoringCriterionDraft[]): string[] {
  return [...criteria].map(c => c.key).sort()
}

async function saveCriteria() {
  // Снапшот ПЕРЕД сохранением — чтобы сравнить с новым набором
  const before = snapshotKeys(criteriaData.value?.criteria?.map((c: any) => ({ ...c })) ?? [])
  const after = snapshotKeys(scoringCriteria.value)
  const setChanged = before.length !== after.length || before.some((k, i) => k !== after[i])

  isSaving.value = true
  try {
    await $fetch(`/api/jobs/${jobId}/criteria`, {
      method: 'POST',
      body: {
        criteria: scoringCriteria.value.map((c, i) => ({
          key: c.key,
          name: c.name,
          description: c.description || undefined,
          category: c.category,
          maxScore: c.maxScore,
          weight: c.weight,
          displayOrder: i,
        })),
      },
    })
    hasUnsavedChanges.value = false
    track('scoring_criteria_saved', { job_id: jobId, criteria_count: scoringCriteria.value.length })
    toast.success(t('dashboard.jobs.aiAnalysis.criteriaSaved'), t('dashboard.jobs.aiAnalysis.criteriaSavedDesc', { n: scoringCriteria.value.length }))
    await refreshCriteria()

    // Если набор критериев изменился — проверяем есть ли уже проскоренные отклики
    if (setChanged) {
      try {
        const counts = await $fetch<{ totalApplications: number; scoredApplications: number; hasScoredApps: boolean }>(`/api/jobs/${jobId}/scored-count`)
        if (counts.hasScoredApps) {
          rescoreScoredCount.value = counts.scoredApplications
          rescoreTotalCount.value = counts.totalApplications
          showRescoreDialog.value = true
        }
      } catch {
        // silently ignore — диалог просто не покажем
      }
    }
  } catch (err: any) {
    toast.error(t('dashboard.jobs.aiAnalysis.failedToSave'), { message: err?.data?.statusMessage })
  } finally {
    isSaving.value = false
  }
}

async function runRescore(mode: 'rescore_all' | 'all') {
  isRescoring.value = true
  try {
    const res = await $fetch<{ queued: number }>(`/api/jobs/${jobId}/batch-score`, {
      method: 'POST',
      body: { mode },
    })
    toast.success(
      mode === 'rescore_all'
        ? 'Пересчёт запущен'
        : 'Скрининг новых откликов запущен',
      { message: `В очереди: ${res.queued}` },
    )
    showRescoreDialog.value = false
  } catch (err: any) {
    toast.error('Не удалось запустить пересчёт', { message: err?.data?.statusMessage })
  } finally {
    isRescoring.value = false
  }
}

function resetCriteria() {
  if (criteriaData.value?.criteria) {
    scoringCriteria.value = criteriaData.value.criteria.map((c: any) => ({
      key: c.key,
      name: c.name,
      description: c.description ?? '',
      category: c.category ?? 'custom',
      maxScore: c.maxScore ?? 10,
      weight: c.weight ?? 50,
    }))
  } else {
    scoringCriteria.value = []
  }
  hasUnsavedChanges.value = false
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <JobSubNavActions :job-id="jobId" />

    <!-- Loading -->
    <div v-if="jobFetchStatus === 'pending' || criteriaFetchStatus === 'pending'" class="text-center py-12 text-surface-400">
      {{ t('dashboard.jobs.aiAnalysis.loading') }}
    </div>

    <!-- Error -->
    <div
      v-else-if="jobError"
      class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-4 text-sm text-danger-700 dark:text-danger-400"
    >
      {{ jobError.statusCode === 404 ? t('dashboard.jobs.aiAnalysis.jobNotFound') : t('dashboard.jobs.aiAnalysis.failedToLoad') }}
      <NuxtLink :to="$localePath('/dashboard')" class="underline ml-1">{{ t('dashboard.jobs.aiAnalysis.backToJobs') }}</NuxtLink>
    </div>

    <template v-else-if="job">
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">{{ t('dashboard.jobs.aiAnalysis.pageTitle') }}</h1>
        <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">
          {{ t('dashboard.jobs.aiAnalysis.pageDesc') }} <strong>{{ job.title }}</strong>.
        </p>
      </div>

      <!-- Empty state: mode selection -->
      <div v-if="scoringCriteria.length === 0" class="space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Pre-made templates -->
          <button
            type="button"
            class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700"
            @click="selectedTemplate = 'standard'"
          >
            <div class="inline-flex items-center justify-center size-10 rounded-lg bg-brand-100 dark:bg-brand-900/50">
              <Brain class="size-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.aiAnalysis.premadeTemplates') }}</span>
              <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                {{ t('dashboard.jobs.aiAnalysis.premadeTemplatesDesc') }}
              </span>
            </div>
          </button>

          <!-- AI from job description -->
          <button
            type="button"
            class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700"
            @click="generateAiCriteria()"
          >
            <div class="inline-flex items-center justify-center size-10 rounded-lg bg-purple-100 dark:bg-purple-900/50">
              <Sparkles class="size-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.aiAnalysis.generateFromDesc') }}</span>
              <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                {{ t('dashboard.jobs.aiAnalysis.generateFromDescHint') }}
              </span>
            </div>
            <span v-if="isGeneratingCriteria" class="absolute top-3 right-3">
              <Loader2 class="size-4 text-purple-600 animate-spin" />
            </span>
          </button>

          <!-- Custom criteria -->
          <button
            type="button"
            class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700"
            @click="showCustomForm = true"
          >
            <div class="inline-flex items-center justify-center size-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
              <SlidersHorizontal class="size-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.aiAnalysis.writeYourOwn') }}</span>
              <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                {{ t('dashboard.jobs.aiAnalysis.writeYourOwnHint') }}
              </span>
            </div>
          </button>
        </div>

        <!-- Pre-made template selector -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            v-for="tmpl in [
              { key: 'standard' as const, label: t('dashboard.jobs.aiAnalysis.templateStandard'), desc: t('dashboard.jobs.aiAnalysis.templateStandardDesc') },
              { key: 'technical' as const, label: t('dashboard.jobs.aiAnalysis.templateTechnical'), desc: t('dashboard.jobs.aiAnalysis.templateTechnicalDesc') },
              { key: 'non_technical' as const, label: t('dashboard.jobs.aiAnalysis.templateNonTechnical'), desc: t('dashboard.jobs.aiAnalysis.templateNonTechnicalDesc') },
            ]"
            :key="tmpl.key"
            type="button"
            class="p-4 rounded-lg border text-left transition-all"
            :class="selectedTemplate === tmpl.key
              ? 'border-brand-400 dark:border-brand-600 bg-brand-50 dark:bg-brand-950/30'
              : 'border-surface-200 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50'"
            @click="selectedTemplate = tmpl.key; loadTemplate(tmpl.key)"
          >
            <span class="block text-sm font-medium text-surface-900 dark:text-surface-100">{{ tmpl.label }}</span>
            <span class="text-xs text-surface-500">{{ tmpl.desc }}</span>
          </button>
        </div>

        <!-- No criteria hint -->
        <div class="text-center py-4 text-sm text-surface-400">
          <p>{{ t('dashboard.jobs.aiAnalysis.noCriteria') }}</p>
        </div>
      </div>

      <!-- Criteria list -->
      <div v-if="scoringCriteria.length > 0" class="space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">
            {{ scoringCriteria.length }} {{ scoringCriteria.length === 1 ? t('dashboard.jobs.aiAnalysis.oneCriterion') : t('dashboard.jobs.aiAnalysis.manyCriteria') }} {{ t('dashboard.jobs.aiAnalysis.configured') }}
          </h3>
          <div class="flex items-center gap-2">
            <button
              v-if="hasUnsavedChanges"
              type="button"
              class="inline-flex items-center gap-1.5 text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300"
              @click="resetCriteria"
            >
              <RotateCcw class="size-3" />
              {{ t('dashboard.jobs.aiAnalysis.reset') }}
            </button>
            <button
              type="button"
              class="text-xs text-danger-600 dark:text-danger-400 hover:underline"
              @click="scoringCriteria = []"
            >
              {{ t('dashboard.jobs.aiAnalysis.clearAll') }}
            </button>
          </div>
        </div>

        <div class="space-y-3">
          <div
            v-for="criterion in scoringCriteria"
            :key="criterion.key"
            class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-4 transition-all hover:shadow-sm"
          >
            <!-- Шапка: бейдж категории + кнопка удаления -->
            <div class="flex items-start justify-between gap-3 mb-3">
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset shrink-0"
                :class="categoryColorClasses[criterion.category] ?? categoryColorClasses.custom"
              >
                {{ categoryLabels[criterion.category] ?? criterion.category }}
              </span>
              <button
                type="button"
                class="rounded p-1 text-surface-400 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950 transition-colors shrink-0"
                :title="t('dashboard.jobs.aiAnalysis.remove')"
                @click="removeCriterion(criterion.key)"
              >
                <Trash2 class="size-4" />
              </button>
            </div>

            <!-- Имя критерия (инлайн) -->
            <div class="mb-2">
              <label class="block text-[10px] uppercase tracking-wide font-medium text-surface-400 dark:text-surface-500 mb-1">
                {{ t('dashboard.jobs.aiAnalysis.criterionName') }}
              </label>
              <input
                v-model="criterion.name"
                type="text"
                maxlength="200"
                class="w-full rounded-lg border border-surface-200 dark:border-surface-800 bg-transparent px-2 py-1.5 text-sm font-semibold text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <!-- Описание (инлайн) -->
            <div class="mb-3">
              <label class="block text-[10px] uppercase tracking-wide font-medium text-surface-400 dark:text-surface-500 mb-1">
                {{ t('dashboard.jobs.aiAnalysis.criterionDescription') }}
              </label>
              <textarea
                v-model="criterion.description"
                rows="2"
                maxlength="1000"
                :placeholder="t('dashboard.jobs.aiAnalysis.criterionDescriptionPlaceholder')"
                class="w-full rounded-lg border border-surface-200 dark:border-surface-800 bg-transparent px-2 py-1.5 text-xs text-surface-600 dark:text-surface-300 leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <!-- Категория + Макс. балл (инлайн) -->
            <div class="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label class="block text-[10px] uppercase tracking-wide font-medium text-surface-400 dark:text-surface-500 mb-1">
                  {{ t('dashboard.jobs.aiAnalysis.criterionCategory') }}
                </label>
                <select
                  v-model="criterion.category"
                  class="w-full rounded-lg border border-surface-200 dark:border-surface-800 bg-transparent px-2 py-1.5 text-xs text-surface-700 dark:text-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option>
                </select>
              </div>
              <div>
                <label class="block text-[10px] uppercase tracking-wide font-medium text-surface-400 dark:text-surface-500 mb-1">
                  {{ t('dashboard.jobs.aiAnalysis.criterionMaxScore') }}
                </label>
                <input
                  v-model.number="criterion.maxScore"
                  type="number"
                  min="1"
                  max="100"
                  class="w-full rounded-lg border border-surface-200 dark:border-surface-800 bg-transparent px-2 py-1.5 text-xs text-surface-700 dark:text-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            <!-- Слайдер веса -->
            <div class="flex items-center gap-4">
              <label class="text-xs font-medium text-surface-500 dark:text-surface-400 shrink-0 w-12">{{ t('dashboard.jobs.aiAnalysis.weight') }}</label>
              <input
                type="range"
                :min="0"
                :max="100"
                v-model.number="criterion.weight"
                class="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-brand-600 bg-surface-200 dark:bg-surface-700"
              />
              <span class="text-xs font-mono font-semibold text-surface-700 dark:text-surface-300 w-8 text-right">
                {{ criterion.weight }}
              </span>
            </div>
          </div>
        </div>

        <!-- Add another criterion -->
        <button
          v-if="!showCustomForm"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-surface-300 dark:border-surface-700 px-3 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:border-brand-400 dark:hover:border-brand-600 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors"
          @click="showCustomForm = true"
        >
          <Plus class="size-4" />
          {{ t('dashboard.jobs.aiAnalysis.addCriterion') }}
        </button>

        <!-- Save / Reset bar -->
        <div class="flex items-center gap-3 pt-4 border-t border-surface-200 dark:border-surface-800">
          <button
            type="button"
            :disabled="isSaving || !hasUnsavedChanges"
            class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="saveCriteria"
          >
            <Loader2 v-if="isSaving" class="size-4 animate-spin" />
            <Save v-else class="size-4" />
            {{ t('dashboard.jobs.aiAnalysis.saveCriteria') }}
          </button>
          <span v-if="hasUnsavedChanges" class="text-xs text-amber-600 dark:text-amber-400">{{ t('dashboard.jobs.aiAnalysis.unsavedChanges') }}</span>
        </div>
      </div>

      <!-- Custom criterion form -->
      <div v-if="showCustomForm" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5 space-y-4 mt-6">
        <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ t('dashboard.jobs.aiAnalysis.addCustomCriterion') }}</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ t('dashboard.jobs.aiAnalysis.criterionNameRequired') }}</label>
            <input
              v-model="customCriterionForm.name"
              type="text"
              placeholder="например, Локация в Москве"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ t('dashboard.jobs.aiAnalysis.criterionCategory') }}</label>
            <select
              v-model="customCriterionForm.category"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ t('dashboard.jobs.aiAnalysis.criterionDescription') }}</label>
          <textarea
            v-model="customCriterionForm.description"
            rows="2"
:placeholder="t('dashboard.jobs.aiAnalysis.criterionDescriptionPlaceholder')"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ t('dashboard.jobs.aiAnalysis.criterionMaxScore') }}</label>
            <input
              v-model.number="customCriterionForm.maxScore"
              type="number"
              min="1"
              max="100"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ t('dashboard.jobs.aiAnalysis.criterionWeight') }}</label>
            <input
              v-model.number="customCriterionForm.weight"
              type="number"
              min="0"
              max="100"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>
        <div class="flex items-center gap-3 pt-2">
          <button
            type="button"
            :disabled="!customCriterionForm.name.trim()"
            class="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="addCustomCriterion"
          >
            {{ t('dashboard.jobs.aiAnalysis.addCriterion') }}
          </button>
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors"
            @click="showCustomForm = false"
          >
            {{ t('dashboard.jobs.aiAnalysis.cancel') }}
          </button>
        </div>
      </div>

      <!-- Auto-score toggle -->
      <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5 mt-6">
        <label class="flex items-start gap-3 cursor-pointer">
          <input
            v-model="autoScoreOnApply"
            type="checkbox"
            class="mt-0.5 size-4 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500 cursor-pointer"
            @change="toggleAutoScore"
          />
          <div>
            <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">
              {{ t('dashboard.jobs.aiAnalysis.autoScore') }}
            </span>
            <span class="text-xs text-surface-500 dark:text-surface-400 mt-0.5 block leading-relaxed">
              {{ t('dashboard.jobs.aiAnalysis.autoScoreDesc') }}
            </span>
          </div>
        </label>
      </div>
    </template>

    <!-- Диалог пересчёта оценок после изменения критериев -->
    <Teleport to="body">
      <div
        v-if="showRescoreDialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        @click.self="!isRescoring && (showRescoreDialog = false)"
      >
        <div class="w-full max-w-md rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 shadow-xl p-6 space-y-4">
          <div>
            <h3 class="text-base font-semibold text-surface-900 dark:text-surface-50">
              Критерии обновлены — пересчитать оценки?
            </h3>
            <p class="mt-2 text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
              У этой вакансии уже есть
              <strong>{{ rescoreScoredCount }}</strong> проскоренных откликов
              <span v-if="rescoreTotalCount > rescoreScoredCount" class="text-surface-400">
                (всего {{ rescoreTotalCount }}).
              </span>
              Они были оценены по старому набору критериев. Пересчитать с новыми?
            </p>
          </div>
          <div class="flex flex-col gap-2 pt-2">
            <button
              type="button"
              :disabled="isRescoring"
              class="w-full px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              @click="runRescore('rescore_all')"
            >
              <Loader2 v-if="isRescoring" class="inline size-4 mr-1.5 animate-spin" />
              Пересчитать все отклики ({{ rescoreScoredCount }})
            </button>
            <button
              v-if="rescoreTotalCount > rescoreScoredCount"
              type="button"
              :disabled="isRescoring"
              class="w-full px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 bg-surface-100 dark:bg-surface-800 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              @click="runRescore('all')"
            >
              Скорить только новые ({{ rescoreTotalCount - rescoreScoredCount }})
            </button>
            <button
              type="button"
              :disabled="isRescoring"
              class="w-full px-4 py-2 text-sm font-medium text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              @click="showRescoreDialog = false"
            >
              Позже
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
