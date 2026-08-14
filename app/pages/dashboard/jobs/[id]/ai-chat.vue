<script setup lang="ts">
/**
 * Чат 2.0: настройки ИИ-чата под конкретную вакансию.
 *
 * Глобальный профиль (персона, модель, база знаний) — в /dashboard/settings/assistant.
 * Здесь — надстройка per-вакансия: цели общения, доп. контекст, переопределение тона
 * и режим ассистента по умолчанию для новых диалогов этой вакансии.
 */
import { Bot, ExternalLink, Save, Sparkles } from 'lucide-vue-next'

const { t } = useI18n()

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const jobId = route.params.id as string

const { job } = useJob(jobId)

useSeoMeta({
  title: computed(() =>
    job.value ? `${t('dashboard.jobs.aiChat.pageTitle')} — ${job.value.title}` : t('dashboard.jobs.aiChat.pageTitle'),
  ),
  robots: 'noindex, nofollow',
})

interface JobAssistantSettings {
  enabled: boolean
  goals: string | null
  extraContext: string | null
  toneOverride: 'formal' | 'neutral' | 'friendly' | null
  defaultAssistantMode: 'off' | 'copilot' | 'autopilot_review' | 'autopilot'
}

const { data, pending } = await useFetch<{ settings: JobAssistantSettings }>(
  `/api/jobs/${jobId}/assistant-settings`,
  { key: `job-assistant-settings-${jobId}`, headers: useRequestHeaders(['cookie']) },
)

const form = reactive<JobAssistantSettings>({
  enabled: true,
  goals: null,
  extraContext: null,
  toneOverride: null,
  defaultAssistantMode: 'off',
})

watch(data, (v) => {
  if (v?.settings) Object.assign(form, v.settings)
}, { immediate: true })

const toneOptions = computed(() => ([
  { value: '', label: t('dashboard.jobs.aiChat.toneInherit') },
  { value: 'formal', label: t('dashboard.jobs.aiChat.toneFormal') },
  { value: 'neutral', label: t('dashboard.jobs.aiChat.toneNeutral') },
  { value: 'friendly', label: t('dashboard.jobs.aiChat.toneFriendly') },
]))

const modeOptions = computed(() => ([
  { value: 'off', label: t('dashboard.chat.modeOff'), hint: t('dashboard.jobs.aiChat.modeOffHint') },
  { value: 'copilot', label: t('dashboard.chat.modeCopilot'), hint: t('dashboard.jobs.aiChat.modeCopilotHint') },
  { value: 'autopilot_review', label: t('dashboard.chat.modeAutopilotReview'), hint: t('dashboard.jobs.aiChat.modeAutopilotReviewHint') },
  { value: 'autopilot', label: t('dashboard.chat.modeAutopilot'), hint: t('dashboard.jobs.aiChat.modeAutopilotHint') },
]))

const saving = ref(false)
const saveError = ref<string | null>(null)
const saveSuccess = ref(false)

async function save() {
  saving.value = true
  saveError.value = null
  saveSuccess.value = false
  try {
    await $fetch(`/api/jobs/${jobId}/assistant-settings`, {
      method: 'PUT',
      body: {
        enabled: form.enabled,
        goals: form.goals || null,
        extraContext: form.extraContext || null,
        toneOverride: form.toneOverride || null,
        defaultAssistantMode: form.defaultAssistantMode,
      },
    })
    saveSuccess.value = true
    setTimeout(() => { saveSuccess.value = false }, 3000)
  }
  catch (err: any) {
    saveError.value = err?.data?.statusMessage ?? t('dashboard.jobs.aiChat.saveError')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 sm:px-6 py-8">
    <div class="flex items-center gap-3 mb-1">
      <div class="flex size-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-950/40">
        <Bot class="size-5 text-brand-600 dark:text-brand-400" />
      </div>
      <div>
        <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">{{ t('dashboard.jobs.aiChat.title') }}</h1>
        <p class="text-xs text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.aiChat.subtitle') }}</p>
      </div>
    </div>

    <div v-if="pending" class="text-center py-12 text-surface-400">
      <div class="size-6 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin mx-auto" />
    </div>

    <form v-else class="mt-6 space-y-6" @submit.prevent="save">
      <!-- Включение per-вакансия -->
      <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-4 flex items-center justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-surface-800 dark:text-surface-100">{{ t('dashboard.jobs.aiChat.enabledLabel') }}</p>
          <p class="text-xs text-surface-400 dark:text-surface-500 mt-0.5">{{ t('dashboard.jobs.aiChat.enabledHint') }}</p>
        </div>
        <button
          type="button"
          class="cursor-pointer relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
          :class="form.enabled ? 'bg-brand-600' : 'bg-surface-300 dark:bg-surface-700'"
          @click="form.enabled = !form.enabled"
        >
          <span class="inline-block size-4 transform rounded-full bg-white transition-transform" :class="form.enabled ? 'translate-x-6' : 'translate-x-1'" />
        </button>
      </div>

      <!-- Режим по умолчанию -->
      <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-4 space-y-3">
        <div class="flex items-center gap-2">
          <Sparkles class="size-4 text-brand-600 dark:text-brand-400" />
          <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-100">{{ t('dashboard.jobs.aiChat.modeTitle') }}</h2>
        </div>
        <p class="text-xs text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.aiChat.modeHint') }}</p>
        <div class="space-y-2">
          <label
            v-for="m in modeOptions"
            :key="m.value"
            class="flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors"
            :class="form.defaultAssistantMode === m.value
              ? 'border-brand-400 dark:border-brand-600 bg-brand-50/60 dark:bg-brand-950/30'
              : 'border-surface-200/80 dark:border-surface-800/60 hover:border-surface-300 dark:hover:border-surface-700'"
          >
            <input
              v-model="form.defaultAssistantMode"
              type="radio"
              :value="m.value"
              class="mt-0.5 size-4 accent-brand-600"
            >
            <span>
              <span class="block text-sm font-medium text-surface-800 dark:text-surface-100">{{ m.label }}</span>
              <span class="block text-xs text-surface-400 dark:text-surface-500 mt-0.5">{{ m.hint }}</span>
            </span>
          </label>
        </div>
      </div>

      <!-- Цели общения -->
      <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-4 space-y-3">
        <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-100">{{ t('dashboard.jobs.aiChat.goalsLabel') }}</h2>
        <p class="text-xs text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.aiChat.goalsHint') }}</p>
        <textarea
          v-model="form.goals"
          rows="4"
          :placeholder="t('dashboard.jobs.aiChat.goalsPlaceholder')"
          class="w-full resize-y rounded-lg border border-surface-200/80 dark:border-surface-700/60 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
      </div>

      <!-- Доп. контекст -->
      <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-4 space-y-3">
        <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-100">{{ t('dashboard.jobs.aiChat.contextLabel') }}</h2>
        <p class="text-xs text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.aiChat.contextHint') }}</p>
        <textarea
          v-model="form.extraContext"
          rows="6"
          :placeholder="t('dashboard.jobs.aiChat.contextPlaceholder')"
          class="w-full resize-y rounded-lg border border-surface-200/80 dark:border-surface-700/60 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
      </div>

      <!-- Тон -->
      <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-4 space-y-3">
        <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-100">{{ t('dashboard.jobs.aiChat.toneLabel') }}</h2>
        <p class="text-xs text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.aiChat.toneHint') }}</p>
        <select
          :value="form.toneOverride ?? ''"
          class="w-full sm:w-64 cursor-pointer rounded-lg border border-surface-200/80 dark:border-surface-700/60 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          @change="form.toneOverride = (($event.target as HTMLSelectElement).value || null) as any"
        >
          <option v-for="o in toneOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>

      <!-- Ссылка на глобальные настройки -->
      <NuxtLink
        to="/dashboard/settings/assistant"
        class="inline-flex items-center gap-1.5 text-xs text-brand-600 dark:text-brand-400 hover:underline"
      >
        <ExternalLink class="size-3.5" />
        {{ t('dashboard.jobs.aiChat.globalSettingsLink') }}
      </NuxtLink>

      <!-- Сохранение -->
      <div class="flex items-center gap-3">
        <button
          type="submit"
          class="cursor-pointer inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
          :disabled="saving"
        >
          <Save class="size-4" />
          {{ saving ? t('dashboard.jobs.aiChat.saving') : t('dashboard.jobs.aiChat.save') }}
        </button>
        <span v-if="saveSuccess" class="text-xs text-success-600 dark:text-success-400">{{ t('dashboard.jobs.aiChat.saved') }}</span>
        <span v-if="saveError" class="text-xs text-danger-600 dark:text-danger-400">{{ saveError }}</span>
      </div>
    </form>
  </div>
</template>
