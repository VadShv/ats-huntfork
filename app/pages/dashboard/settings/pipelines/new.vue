<script setup lang="ts">
import { ArrowLeft, Loader2, GitBranch, Lock, Check } from 'lucide-vue-next'
import type { PipelineStage } from '~/components/PipelineStageEditor.vue'

definePageMeta({})

useSeoMeta({
  title: 'Создать воронку',
})

const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()

// ── Form state ──
const name = ref('')
const description = ref('')

// ─────────────────────────────────────────────
// Спринт 11.2: выбор пресета воронки
// ─────────────────────────────────────────────

type PresetKey = 'hh_standard' | 'simple' | 'scratch'

interface PreviewStage {
  name: string
  color: string
  isSub?: boolean
  bucket: 'working' | 'rejected'
}

// Превью — зеркало server/utils/pipeline-seed.ts (HH_STANDARD_STAGES / SIMPLE_STAGES)
const HH_PREVIEW: PreviewStage[] = [
  { name: 'Все неразобранные', color: '#94a3b8', bucket: 'working' },
  { name: 'Подходящие', color: '#94a3b8', isSub: true, bucket: 'working' },
  { name: 'Подумать', color: '#a8a29e', bucket: 'working' },
  { name: 'Вернуться позже', color: '#a8a29e', isSub: true, bucket: 'working' },
  { name: 'Первичный контакт', color: '#0ea5e9', bucket: 'working' },
  { name: 'Звонок', color: '#0ea5e9', isSub: true, bucket: 'working' },
  { name: 'Мессенджер', color: '#0ea5e9', isSub: true, bucket: 'working' },
  { name: 'Связаться ещё раз', color: '#0ea5e9', isSub: true, bucket: 'working' },
  { name: 'Тестовое задание', color: '#6366f1', bucket: 'working' },
  { name: 'Интервью', color: '#a855f7', bucket: 'working' },
  { name: 'Предложение о работе', color: '#eab308', bucket: 'working' },
  { name: 'Выход на работу', color: '#10b981', bucket: 'working' },
  { name: 'Не подходит', color: '#ef4444', bucket: 'rejected' },
  { name: 'Кандидат отказался', color: '#f97316', bucket: 'rejected' },
  { name: 'Не выходит на связь', color: '#e11d48', bucket: 'rejected' },
  { name: 'Вакансия закрыта', color: '#71717a', bucket: 'rejected' },
  { name: 'Перевод на другую вакансию', color: '#8b5cf6', bucket: 'rejected' },
]

const SIMPLE_PREVIEW: PreviewStage[] = [
  { name: 'Новый', color: '#94a3b8', bucket: 'working' },
  { name: 'Скрининг', color: '#3b82f6', bucket: 'working' },
  { name: 'Интервью', color: '#a855f7', bucket: 'working' },
  { name: 'Оффер', color: '#eab308', bucket: 'working' },
  { name: 'Принят', color: '#10b981', bucket: 'working' },
  { name: 'Отказ', color: '#ef4444', bucket: 'rejected' },
]

const presetOptions: { key: PresetKey, title: string, subtitle: string, badge?: string }[] = [
  {
    key: 'hh_standard',
    title: 'Стандартный hh.ru',
    subtitle: '17 этапов 1-в-1 с hh.ru: от «Все неразобранные» до «Выход на работу» + 5 отказных статусов. Базовые этапы защищены от изменения.',
    badge: 'Рекомендуется',
  },
  {
    key: 'simple',
    title: 'Простой',
    subtitle: '6 этапов: Новый → Скрининг → Интервью → Оффер → Принят / Отказ. Базовые этапы защищены от изменения.',
  },
  {
    key: 'scratch',
    title: 'С нуля',
    subtitle: 'Соберите собственный набор этапов вручную.',
  },
]

const selectedPreset = ref<PresetKey>('hh_standard')

const presetPreview = computed<PreviewStage[]>(() => {
  if (selectedPreset.value === 'hh_standard') return HH_PREVIEW
  if (selectedPreset.value === 'simple') return SIMPLE_PREVIEW
  return []
})

const previewWorking = computed(() => presetPreview.value.filter(s => s.bucket === 'working'))
const previewRejected = computed(() => presetPreview.value.filter(s => s.bucket === 'rejected'))

// ── Редактор «С нуля» ──
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
  if (!hasName || isSubmitting.value) return false
  if (selectedPreset.value !== 'scratch') return true
  return stageEditorRef.value?.isValid ?? false
})

async function handleSubmit() {
  if (!canSubmit.value) return

  nameError.value = ''
  isSubmitting.value = true

  try {
    const body: Record<string, unknown> = {
      name: name.value.trim(),
      description: description.value.trim() || undefined,
    }

    if (selectedPreset.value === 'scratch') {
      body.stages = stages.value
        .filter(s => !s.isArchived)
        .map(s => ({
          name: s.name,
          description: s.description || undefined,
          type: s.type,
          isTerminal: s.isTerminal,
        }))
    }
    else {
      body.preset = selectedPreset.value
    }

    await $fetch('/api/pipelines', {
      method: 'POST',
      body,
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

        <!-- ─── Спринт 11.2: выбор пресета ─── -->
        <div class="mb-6">
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
            Набор этапов
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              v-for="opt in presetOptions"
              :key="opt.key"
              type="button"
              class="relative rounded-lg border p-3 text-left transition-all"
              :class="selectedPreset === opt.key
                ? 'border-brand-500 dark:border-brand-500 ring-1 ring-brand-500 bg-brand-50/50 dark:bg-brand-950/30'
                : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600 bg-white dark:bg-surface-800/50'"
              @click="selectedPreset = opt.key"
            >
              <div class="flex items-center justify-between gap-1 mb-1">
                <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">
                  {{ opt.title }}
                </span>
                <span
                  v-if="selectedPreset === opt.key"
                  class="flex items-center justify-center size-4 rounded-full bg-brand-600 text-white shrink-0"
                >
                  <Check class="size-3" />
                </span>
              </div>
              <span
                v-if="opt.badge"
                class="inline-flex items-center rounded-full bg-brand-100 dark:bg-brand-900/60 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300 mb-1"
              >
                {{ opt.badge }}
              </span>
              <p class="text-[11px] leading-snug text-surface-500 dark:text-surface-400">
                {{ opt.subtitle }}
              </p>
            </button>
          </div>
        </div>

        <!-- Stages section -->
        <div class="mb-6">
          <div class="flex items-center gap-2 mb-2">
            <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
              {{ $t('pipelines.form.stagesTitle') }}
            </h3>
          </div>

          <!-- ─── Превью пресета (read-only) ─── -->
          <template v-if="selectedPreset !== 'scratch'">
            <p class="text-xs text-surface-500 dark:text-surface-400 mb-3 flex items-center gap-1.5">
              <Lock class="size-3.5 shrink-0" />
              Этапы пресета системные: их нельзя переименовать или удалить — только скрыть. Свои этапы можно добавить после создания.
            </p>

            <div class="rounded-lg border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-800 overflow-hidden">
              <div class="px-3 py-1.5 bg-surface-50 dark:bg-surface-800/60 text-[11px] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400">
                В работе
              </div>
              <div
                v-for="stage in previewWorking"
                :key="stage.name"
                class="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-surface-900"
                :class="stage.isSub ? 'pl-8' : ''"
              >
                <div
                  class="size-2 rounded-full shrink-0"
                  :style="{ backgroundColor: stage.color }"
                />
                <span class="text-xs" :class="stage.isSub ? 'text-surface-500 dark:text-surface-400' : 'text-surface-800 dark:text-surface-200 font-medium'">
                  {{ stage.name }}
                </span>
                <Lock class="size-3 text-surface-300 dark:text-surface-600 ml-auto shrink-0" />
              </div>
              <div class="px-3 py-1.5 bg-surface-50 dark:bg-surface-800/60 text-[11px] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400">
                Отказы
              </div>
              <div
                v-for="stage in previewRejected"
                :key="stage.name"
                class="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-surface-900"
              >
                <div
                  class="size-2 rounded-full shrink-0"
                  :style="{ backgroundColor: stage.color }"
                />
                <span class="text-xs text-surface-800 dark:text-surface-200 font-medium">
                  {{ stage.name }}
                </span>
                <Lock class="size-3 text-surface-300 dark:text-surface-600 ml-auto shrink-0" />
              </div>
            </div>
          </template>

          <!-- ─── Редактор «С нуля» ─── -->
          <template v-else>
            <p class="text-xs text-surface-500 dark:text-surface-400 mb-3">
              {{ $t('pipelines.form.stagesHint') }}
            </p>

            <PipelineStageEditor
              ref="stageEditorRef"
              v-model="stages"
            />
          </template>
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
