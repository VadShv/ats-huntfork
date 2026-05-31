<script setup lang="ts">
import { ArrowLeft, Loader2, GitBranch } from 'lucide-vue-next'
import type { PipelineStage } from '~/components/PipelineStageEditor.vue'

definePageMeta({})

useSeoMeta({
  title: 'Создать воронку — Reqcore',
})

const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()

// ── Form state ──
const name = ref('')
const description = ref('')
const stages = ref<PipelineStage[]>([
  { name: t('pipelines.stageType.applied'), type: 'applied', isTerminal: false },
  { name: t('pipelines.stageType.screening'), type: 'screening', isTerminal: false },
  { name: t('pipelines.stageType.interview'), type: 'interview', isTerminal: false },
  { name: t('pipelines.stageType.offer'), type: 'offer', isTerminal: false },
  { name: t('pipelines.stageType.hired'), type: 'hired', isTerminal: true },
  { name: t('pipelines.stageType.rejected'), type: 'rejected', isTerminal: true },
])

const isSubmitting = ref(false)
const nameError = ref('')

// ── Stage editor ref for validation ──
const stageEditorRef = ref<{ isValid: boolean } | null>(null)

const canSubmit = computed(() => {
  const hasName = name.value.trim().length > 0
  const stagesValid = stageEditorRef.value?.isValid ?? false
  return hasName && stagesValid && !isSubmitting.value
})

async function handleSubmit() {
  if (!canSubmit.value) return

  nameError.value = ''
  isSubmitting.value = true

  try {
    await $fetch('/api/pipelines', {
      method: 'POST',
      body: {
        name: name.value.trim(),
        description: description.value.trim() || undefined,
        stages: stages.value
          .filter(s => !s.isArchived)
          .map(s => ({
            name: s.name,
            description: s.description || undefined,
            type: s.type,
            isTerminal: s.isTerminal,
          })),
      },
      headers: useRequestHeaders(['cookie']),
    })
    toast.success(t('pipelines.toast.created'))
    await navigateTo(localePath('/dashboard/settings/pipelines'))
  }
  catch (err: unknown) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    if (msg) {
      toast.error(msg)
    }
    else {
      toast.error('Не удалось создать воронку')
    }
  }
  finally {
    isSubmitting.value = false
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

    <div class="flex items-center gap-3 mb-6">
      <div class="flex items-center justify-center size-9 rounded-lg bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400">
        <GitBranch class="size-5" />
      </div>
      <div>
        <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">
          {{ $t('pipelines.create') }}
        </h1>
      </div>
    </div>

    <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 sm:p-6">
      <form @submit.prevent="handleSubmit">
        <!-- Name -->
        <div class="mb-4">
          <label
            for="pipeline-name"
            class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5"
          >
            {{ $t('pipelines.form.nameLabel') }}
            <span class="text-danger-500 ml-0.5">*</span>
          </label>
          <input
            id="pipeline-name"
            v-model="name"
            type="text"
            maxlength="100"
            :placeholder="$t('pipelines.form.namePlaceholder')"
            class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            :class="nameError ? 'border-danger-400 focus:ring-danger-400' : ''"
          />
          <p v-if="nameError" class="mt-1 text-xs text-danger-600 dark:text-danger-400">
            {{ nameError }}
          </p>
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
            class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors resize-none"
          />
        </div>

        <!-- Stages section -->
        <div class="mb-6">
          <div class="flex items-center gap-2 mb-2">
            <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
              {{ $t('pipelines.form.stagesTitle') }}
            </h3>
          </div>
          <p class="text-xs text-surface-500 dark:text-surface-400 mb-3">
            {{ $t('pipelines.form.stagesHint') }}
          </p>

          <PipelineStageEditor
            ref="stageEditorRef"
            v-model="stages"
          />
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-3 justify-end pt-4 border-t border-surface-100 dark:border-surface-800">
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
            {{ isSubmitting ? 'Создание…' : $t('pipelines.create') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
