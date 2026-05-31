<script setup lang="ts">
import {
  ArrowLeft, Loader2, GitBranch, AlertTriangle, Copy,
  Lock, Briefcase, Users,
} from 'lucide-vue-next'
import type { PipelineStage } from '~/components/PipelineStageEditor.vue'

definePageMeta({})

const route = useRoute()
const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()

const pipelineId = computed(() => route.params.id as string)

// ── Load pipeline ──
interface PipelineDetail {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  isDefault: boolean
  isArchived: boolean
  jobsCount: number
  activeApplicationsCount: number
  stages: Array<{
    id: string
    name: string
    description: string | null
    type: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'custom'
    color: string
    displayOrder: number
    isTerminal: boolean
    isArchived: boolean
    createdAt: string | Date
    updatedAt: string | Date
  }>
  createdAt: string | Date
  updatedAt: string | Date
}

const { data: pipeline, status, error: fetchError, refresh } = useFetch<PipelineDetail>(
  () => `/api/pipelines/${pipelineId.value}`,
  {
    headers: useRequestHeaders(['cookie']),
  },
)

useSeoMeta({
  title: computed(() => pipeline.value ? `${pipeline.value.name} — Воронка` : 'Воронка'),
})

const isLoadingPipeline = computed(() => status.value === 'pending')

// ── Form state ──
const name = ref('')
const description = ref('')
const stages = ref<PipelineStage[]>([])

// Hydrate form when pipeline loads
watch(pipeline, (val) => {
  if (!val) return
  name.value = val.name
  description.value = val.description ?? ''
  stages.value = val.stages
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(s => ({
      id: s.id,
      name: s.name,
      description: s.description ?? undefined,
      type: s.type,
      isTerminal: s.isTerminal,
      isArchived: s.isArchived,
    }))
}, { immediate: true })

// ── Stage editor ref ──
const stageEditorRef = ref<{ isValid: boolean } | null>(null)

const canSubmit = computed(() => {
  if (pipeline.value?.isSystem) return false
  const hasName = name.value.trim().length > 0
  const stagesValid = stageEditorRef.value?.isValid ?? false
  return hasName && stagesValid && !isSubmitting.value
})

// ── Submit (PATCH) ──
const isSubmitting = ref(false)

async function handleSubmit() {
  if (!canSubmit.value) return
  isSubmitting.value = true

  try {
    await $fetch(`/api/pipelines/${pipelineId.value}`, {
      method: 'PATCH',
      body: {
        name: name.value.trim(),
        description: description.value.trim() || null,
        stages: stages.value.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description || null,
          type: s.type,
          isTerminal: s.isTerminal,
          isArchived: s.isArchived ?? false,
        })),
      },
      headers: useRequestHeaders(['cookie']),
    })
    toast.success(t('pipelines.toast.updated'))
    await navigateTo(localePath('/dashboard/settings/pipelines'))
  }
  catch (err: unknown) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    if (msg) {
      toast.error(msg)
    }
    else {
      toast.error('Не удалось сохранить воронку')
    }
  }
  finally {
    isSubmitting.value = false
  }
}

// ── Clone (from system read-only view) ──
const isCloningFromBanner = ref(false)

async function handleCloneAndNavigate() {
  if (!pipeline.value) return
  isCloningFromBanner.value = true
  try {
    const result = await $fetch<{ id: string }>(`/api/pipelines/${pipelineId.value}/clone`, {
      method: 'POST',
      body: {},
      headers: useRequestHeaders(['cookie']),
    })
    toast.success(t('pipelines.toast.cloned'))
    await navigateTo(localePath(`/dashboard/settings/pipelines/${result.id}`))
  }
  catch (err: unknown) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? 'Ошибка при клонировании'
    toast.error(msg)
  }
  finally {
    isCloningFromBanner.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <!-- Back link -->
    <NuxtLink
      :to="localePath('/dashboard/settings/pipelines')"
      class="inline-flex items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 transition-colors no-underline mb-5"
    >
      <ArrowLeft class="size-4" />
      {{ $t('pipelines.title') }}
    </NuxtLink>

    <!-- Loading state -->
    <div v-if="isLoadingPipeline" class="flex items-center justify-center py-12 text-surface-400">
      <Loader2 class="size-6 animate-spin mr-2" />
      <span class="text-sm">Загрузка…</span>
    </div>

    <!-- Error state -->
    <div v-else-if="fetchError" class="rounded-xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/40 p-6 text-center">
      <AlertTriangle class="size-8 text-danger-400 mx-auto mb-2" />
      <p class="text-sm text-danger-700 dark:text-danger-400 mb-2">
        Не удалось загрузить воронку.
      </p>
      <button
        class="text-sm text-brand-600 hover:text-brand-700 underline"
        @click="refresh"
      >
        Повторить
      </button>
    </div>

    <!-- Content -->
    <template v-else-if="pipeline">
      <!-- Header -->
      <div class="flex items-center gap-3 mb-4">
        <div class="flex items-center justify-center size-9 rounded-lg bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400">
          <GitBranch class="size-5" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50 truncate">
              {{ pipeline.name }}
            </h1>
            <span
              v-if="pipeline.isSystem"
              class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[10px] font-medium text-surface-500 dark:text-surface-400 border border-surface-200 dark:border-surface-700"
            >
              {{ $t('pipelines.badges.system') }}
            </span>
            <span
              v-if="pipeline.isDefault"
              class="inline-flex items-center rounded-full bg-brand-50 dark:bg-brand-950/50 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800"
            >
              {{ $t('pipelines.badges.default') }}
            </span>
          </div>
        </div>
      </div>

      <!-- Stats bar -->
      <div class="flex items-center gap-4 mb-5 text-sm text-surface-500 dark:text-surface-400">
        <span class="inline-flex items-center gap-1.5">
          <Briefcase class="size-3.5" />
          {{ $t('pipelines.stats.usedInJobs', { count: pipeline.jobsCount }) }}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <Users class="size-3.5" />
          {{ $t('pipelines.stats.activeApplications', { count: pipeline.activeApplicationsCount }) }}
        </span>
      </div>

      <!-- System read-only banner -->
      <div
        v-if="pipeline.isSystem"
        class="mb-5 rounded-xl border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950/40 p-4"
      >
        <div class="flex items-start gap-3">
          <Lock class="size-5 text-warning-600 dark:text-warning-400 shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <p class="text-sm text-warning-800 dark:text-warning-300 font-medium mb-1">
              {{ $t('pipelines.systemReadOnly') }}
            </p>
            <button
              type="button"
              :disabled="isCloningFromBanner"
              class="inline-flex items-center gap-1.5 rounded-lg bg-warning-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-warning-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
              @click="handleCloneAndNavigate"
            >
              <Loader2 v-if="isCloningFromBanner" class="size-3.5 animate-spin" />
              <Copy v-else class="size-3.5" />
              {{ $t('pipelines.actions.cloneAndEdit') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Form (read-only for system pipelines) -->
      <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 sm:p-6">
        <form @submit.prevent="handleSubmit">
          <!-- Name -->
          <div class="mb-4">
            <label
              for="pipeline-name"
              class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5"
            >
              {{ $t('pipelines.form.nameLabel') }}
              <span v-if="!pipeline.isSystem" class="text-danger-500 ml-0.5">*</span>
            </label>
            <input
              id="pipeline-name"
              v-model="name"
              type="text"
              maxlength="100"
              :placeholder="$t('pipelines.form.namePlaceholder')"
              :disabled="pipeline.isSystem"
              class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>

          <!-- Description -->
          <div class="mb-6">
            <label
              for="pipeline-description"
              class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5"
            >
              {{ $t('pipelines.form.descriptionLabel') }}
            </label>
            <textarea
              id="pipeline-description"
              v-model="description"
              rows="2"
              maxlength="500"
              :placeholder="$t('pipelines.form.descriptionPlaceholder')"
              :disabled="pipeline.isSystem"
              class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors resize-none disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>

          <!-- Stages -->
          <div class="mb-6">
            <div class="flex items-center gap-2 mb-2">
              <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
                {{ $t('pipelines.form.stagesTitle') }}
              </h3>
            </div>
            <p v-if="!pipeline.isSystem" class="text-xs text-surface-500 dark:text-surface-400 mb-3">
              {{ $t('pipelines.form.stagesHint') }}
            </p>

            <PipelineStageEditor
              ref="stageEditorRef"
              v-model="stages"
              :disabled="pipeline.isSystem"
            />
          </div>

          <!-- Actions (hidden for system pipelines) -->
          <div
            v-if="!pipeline.isSystem"
            class="flex items-center gap-3 justify-end pt-4 border-t border-surface-100 dark:border-surface-800"
          >
            <NuxtLink
              :to="localePath('/dashboard/settings/pipelines')"
              class="rounded-lg px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors no-underline"
            >
              {{ $t('common.cancel') }}
            </NuxtLink>
            <button
              type="submit"
              :disabled="!canSubmit"
              class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Loader2 v-if="isSubmitting" class="size-4 animate-spin" />
              {{ isSubmitting ? 'Сохранение…' : $t('common.save') }}
            </button>
          </div>
        </form>
      </div>
    </template>
  </div>
</template>
