<script setup lang="ts">
import { ArrowLeft, User, Briefcase, Calendar, Clock, Hash, FileText, MessageSquare, GitBranch, Keyboard, X, ShieldCheck, RefreshCw, AlertTriangle } from 'lucide-vue-next'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'
import ApplicationCommentThread from '~/components/Comments/ApplicationCommentThread.vue'
import CommsChatPanel from '~/components/Comms/CommsChatPanel.vue'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const applicationId = route.params.id as string
const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const toast = useToast()

const { application, status: fetchStatus, error, refresh, updateApplication } = useApplication(applicationId)
const { t, te } = useI18n()

/** Reactive stage state — updated optimistically when picker emits */
const localStageId = ref<string | null>(null)
const localStageName = ref<string | null>(null)
const localStageColor = ref<string | null>(null)

watch(
  () => application.value,
  (app) => {
    if (app) {
      localStageId.value = (app as { currentStageId?: string | null }).currentStageId ?? null
      localStageName.value = (app as { currentStage?: { name: string } | null }).currentStage?.name ?? null
      localStageColor.value = (app as { currentStage?: { color: string } | null }).currentStage?.color ?? null
    }
  },
  { immediate: true },
)

function handleStageChanged(payload: { newStageId: string; newStageName: string; newStageColor: string }) {
  localStageId.value = payload.newStageId
  localStageName.value = payload.newStageName
  localStageColor.value = payload.newStageColor
  // Full refresh to keep all data in sync
  void refresh()
  // Спринт 22: hh-пуш при переводе — fire-and-forget, перепроверяем синк чуть позже
  setTimeout(() => { void loadHhSync() }, 4000)
}

// ─── Спринт 22 (todo 8): индикатор рассинхрона с hh.ru ───
type HhSyncStatus = {
  applicable: boolean
  reason?: string
  inSync?: boolean
  expectedCollection?: string | null
  actualCollection?: string | null
  lastError?: string | null
  lastAttemptAt?: string | null
}
const hhSync = ref<HhSyncStatus | null>(null)
async function loadHhSync() {
  try {
    hhSync.value = await $fetch<HhSyncStatus>(`/api/applications/${applicationId}/hh-sync-status`, {
      headers: useRequestHeaders(['cookie']),
    })
  }
  catch {
    hhSync.value = null
  }
}
onMounted(() => { void loadHhSync() })

// Спринт 22 (todo 9): после перевода — на карточку нового отклика
const localePath = useLocalePath()
function handleTransferred(payload: { newApplicationId: string }) {
  void navigateTo(localePath(`/dashboard/applications/${payload.newApplicationId}`))
}

const isResyncing = ref(false)
async function doHhResync() {
  if (isResyncing.value) return
  isResyncing.value = true
  try {
    const res = await $fetch<{ pushed: boolean, reason?: string, status: HhSyncStatus }>(
      `/api/applications/${applicationId}/hh-resync`,
      { method: 'POST', headers: useRequestHeaders(['cookie']) },
    )
    hhSync.value = res.status
    if (res.status?.inSync) {
      toast.success('Синхронизировано с hh.ru')
    }
    else {
      toast.error('Не удалось синхронизировать с hh.ru', { message: res.reason ?? res.status?.lastError ?? undefined })
    }
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Не удалось синхронизировать с hh.ru', { message: err.data?.statusMessage })
  }
  finally {
    isResyncing.value = false
  }
}

const { formatCandidateName } = useOrgSettings()

useSeoMeta({
  title: computed(() =>
    application.value
      ? `${application.value.candidate.firstName} ${application.value.candidate.lastName} → ${application.value.job.title}`
      : 'Application',
  ),
})

// ─────────────────────────────────────────────
// Legacy-переходы статуса (кнопки живут в ApplicationQuickActions)
// ─────────────────────────────────────────────

const isTransitioning = ref(false)
const showInterviewSidebar = ref(false)

async function handleTransition(newStatus: string) {
  isTransitioning.value = true
  try {
    await updateApplication({ status: newStatus as any })
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error(t('applications.failedToUpdateStatus'), { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
  } finally {
    isTransitioning.value = false
  }
}

// «Только ручная обработка» — отключает все авто-правила для этого кандидата.
const isUpdatingManualOnly = ref(false)
async function toggleManualReviewOnly() {
  if (!application.value || isUpdatingManualOnly.value) return
  const candidateId = application.value.candidate.id
  const next = !(application.value.candidate as any).manualReviewOnly
  isUpdatingManualOnly.value = true
  try {
    await $fetch(`/api/candidates/${candidateId}`, {
      method: 'PATCH',
      body: { manualReviewOnly: next },
    })
    await refresh()
    toast.success?.(next ? t('applications.manualOnlyEnabled') : t('applications.manualOnlyDisabled'))
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error(t('applications.failedToUpdateManualOnly'), { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
  } finally {
    isUpdatingManualOnly.value = false
  }
}

// ─────────────────────────────────────────────
// Refs for stage picker
// ─────────────────────────────────────────────
const stagePickerRef = ref<HTMLElement | null>(null)
const showHotkeysModal = ref(false)

// ─────────────────────────────────────────────
// Hotkeys
// ─────────────────────────────────────────────
useHotkeys({
  s: () => {
    // S — открыть/сфокусировать stage picker
    const btn = stagePickerRef.value?.querySelector('button')
    if (btn) (btn as HTMLButtonElement).click()
  },
  c: () => {
    // C — фокус на composer треда
    const composer = document.querySelector<HTMLTextAreaElement>('[data-comment-composer] textarea')
    composer?.focus()
  },
  '?': () => {
    showHotkeysModal.value = !showHotkeysModal.value
  },
})



// ─────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────

const statusBadgeClasses: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  screening: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  interview: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  offer: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400',
  hired: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
  rejected: 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400',
}

function formatResponseValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value ?? '—')
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <!-- Back link -->
    <NuxtLink
      :to="$localePath('/dashboard/applications')"
      class="mb-4 inline-flex items-center gap-1 rounded-full border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-3 py-1.5 text-sm text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
    >
      <ArrowLeft class="size-4" />
      {{ t('applications.back_to_applications') }}
    </NuxtLink>

    <!-- Loading -->
    <div v-if="fetchStatus === 'pending'" class="text-center py-12 text-surface-400">
      {{ t('applications.loading') }}
    </div>

    <!-- Error / not found -->
    <div
      v-else-if="error"
      class="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700"
    >
      {{ error.statusCode === 404 ? t('applications.not_found') : t('applications.failed_to_load') }}
      <NuxtLink :to="$localePath('/dashboard/applications')" class="underline ml-1">{{ t('applications.back_to_applications') }}</NuxtLink>
    </div>

    <!-- Application detail -->
    <template v-else-if="application">
      <!-- Header -->
      <div class="mb-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
        <p class="mb-2 text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">
          {{ $t('applications.overview') }}
        </p>
        <div class="mb-2 flex flex-wrap items-center gap-2 text-surface-400">
          <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50 truncate">
            {{ formatCandidateName(application.candidate) }}
          </h1>
          <span class="text-surface-400">→</span>
          <NuxtLink
            :to="$localePath(`/dashboard/jobs/${application.job.id}`)"
            class="text-xl text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 truncate transition-colors"
          >
            {{ application.job.title }}
          </NuxtLink>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <!-- Pipeline stage picker — shown prominently when a pipeline exists -->
          <div ref="stagePickerRef" class="contents">
          <ApplicationStagePicker
            :application-id="applicationId"
            :current-stage-id="localStageId"
            @stage-changed="handleStageChanged"
          />
          </div>
          <!-- Legacy status: показываем только когда нет стадии pipeline -->
          <StatusBadge v-if="!localStageId" :status="application.status as any" size="sm" />
          <!-- Спринт 22 (todo 8): рассинхрон с hh.ru + кнопка ре-синка -->
          <div
            v-if="hhSync?.applicable && hhSync.inSync === false"
            class="inline-flex items-center gap-1.5"
          >
            <span
              class="inline-flex items-center gap-1 rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400"
              :title="hhSync.lastError
                ? `Последняя ошибка: ${hhSync.lastError}`
                : `На hh.ru: ${hhSync.actualCollection ?? '—'}, ожидается: ${hhSync.expectedCollection ?? '—'}`"
            >
              <AlertTriangle class="size-3" />
              hh: рассинхрон
            </span>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2 py-0.5 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors disabled:opacity-50"
              :disabled="isResyncing"
              title="Повторно отправить текущий этап на hh.ru"
              @click="doHhResync"
            >
              <RefreshCw class="size-3" :class="isResyncing ? 'animate-spin' : ''" />
              Синхронизировать
            </button>
          </div>
          <!-- Спринт 22 (todo 9): перевод на другую вакансию -->
          <NuxtLink
            v-if="(application as any).transferredToApplicationId"
            :to="$localePath(`/dashboard/applications/${(application as any).transferredToApplicationId}`)"
            class="inline-flex items-center gap-1 rounded-full border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
            title="Открыть новый отклик"
          >
            Переведён → новый отклик
          </NuxtLink>
          <ApplicationTransferDialog
            v-else
            :application-id="applicationId"
            :current-job-id="application.job.id"
            @transferred="handleTransferred"
          />
          <TimelineDateLink :date="application.createdAt" class="text-sm text-surface-500 dark:text-surface-400">
            {{ t('applications.applied_label') }} {{ new Date(application.createdAt).toLocaleDateString() }}
          </TimelineDateLink>
        </div>
      </div>

      <!-- Quick actions — Спринт 13.3: единый компонент (карточка + полуокно) -->
      <ApplicationQuickActions
        class="mb-6"
        :application-id="applicationId"
        :current-stage-id="localStageId"
        :status="application.status"
        :disabled="isTransitioning"
        @stage-changed="handleStageChanged"
        @legacy-transition="handleTransition"
        @schedule="showInterviewSidebar = true"
      />

      <!-- Спринт 20: панель решения НМ (видна рекрутёру, если есть эффективное решение) -->
      <ApplicationHmDecisionCard
        class="mb-6"
        :application-id="applicationId"
      />

      <div class="grid gap-4 md:grid-cols-2">
        <!-- Candidate info -->
        <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
          <div class="flex items-center gap-2 mb-3">
            <User class="size-4 text-surface-500 dark:text-surface-400" />
            <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200">{{ t('applications.candidate') }}</h2>
          </div>
          <dl class="grid grid-cols-1 gap-3 text-sm">
            <div>
              <dt class="text-surface-400">{{ t('applications.name') }}</dt>
              <dd class="text-surface-700 dark:text-surface-200 font-medium">
                <NuxtLink
                  :to="$localePath(`/dashboard/candidates/${application.candidate.id}`)"
                  class="text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
                >
                  {{ formatCandidateName(application.candidate) }}
                </NuxtLink>
              </dd>
            </div>
            <div>
              <dt class="text-surface-400">{{ t('applications.email') }}</dt>
              <dd class="text-surface-700 dark:text-surface-200 font-medium">
                <a
                  :href="`mailto:${application.candidate.email}`"
                  target="_blank"
                  class="hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
                >{{ application.candidate.email }}</a>
              </dd>
            </div>
            <div v-if="application.candidate.phone">
              <dt class="text-surface-400">{{ t('applications.phone') }}</dt>
              <dd class="text-surface-700 dark:text-surface-200 font-medium">{{ application.candidate.phone }}</dd>
            </div>
          </dl>

          <!-- «Только ручная обработка» — флаг кандидата против авто-правил -->
          <div class="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800">
            <label class="flex items-start gap-3 cursor-pointer select-none" :class="{ 'opacity-60': isUpdatingManualOnly }">
              <input
                type="checkbox"
                :checked="!!(application.candidate as any).manualReviewOnly"
                :disabled="isUpdatingManualOnly"
                class="mt-0.5 size-4 rounded border-surface-300 dark:border-surface-600 text-info-600 focus:ring-info-500"
                @change="toggleManualReviewOnly"
              />
              <div class="flex-1">
                <div class="flex items-center gap-1.5">
                  <ShieldCheck class="size-3.5 text-info-600 dark:text-info-400" />
                  <span class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ t('applications.manualReviewOnly') }}</span>
                </div>
                <p class="mt-1 text-xs text-surface-500 dark:text-surface-400">{{ t('applications.manualReviewOnlyHint') }}</p>
              </div>
            </label>
          </div>
        </div>

        <!-- Job info -->
        <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
          <div class="flex items-center gap-2 mb-3">
            <Briefcase class="size-4 text-surface-500 dark:text-surface-400" />
            <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200">{{ t('applications.job') }}</h2>
          </div>
          <dl class="grid grid-cols-1 gap-3 text-sm">
            <div>
              <dt class="text-surface-400">{{ t('applications.title') }}</dt>
              <dd class="text-surface-700 dark:text-surface-200 font-medium">
                <NuxtLink
                  :to="$localePath(`/dashboard/jobs/${application.job.id}`)"
                  class="text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
                >
                  {{ application.job.title }}
                </NuxtLink>
              </dd>
            </div>
            <div>
              <dt class="text-surface-400">{{ t('applications.job_status') }}</dt>
              <dd class="text-surface-700 dark:text-surface-200 font-medium">{{ te(`dashboard.jobs.status.${application.job.status}`) ? t(`dashboard.jobs.status.${application.job.status}`) : application.job.status }}</dd>
            </div>
          </dl>
        </div>

        <!-- Application details -->
        <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 md:col-span-2">
          <div class="flex items-center gap-2 mb-3">
            <Hash class="size-4 text-surface-500 dark:text-surface-400" />
            <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200">{{ t('applications.details') }}</h2>
          </div>
          <dl class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt class="text-surface-400">{{ t('applications.score') }}</dt>
              <dd>
                <ScoreBadge :score="application.score" size="sm" />
              </dd>
            </div>
            <div>
              <dt class="text-surface-400">{{ $t('applications.stage.current') }}</dt>
              <dd class="text-surface-700 dark:text-surface-200 font-medium">
                <ApplicationStageBadge
                  :name="localStageName ?? ''"
                  :color="localStageColor ?? '#94a3b8'"
                  size="sm"
                />
              </dd>
            </div>
            <div v-if="!localStageId">
              <dt class="text-surface-400">{{ t('applications.status') }}</dt>
              <dd class="text-surface-700 dark:text-surface-200 font-medium">{{ te(`dashboard.applications.stages.${application.status}`) ? t(`dashboard.applications.stages.${application.status}`) : application.status }}</dd>
            </div>
            <div>
              <dt class="text-surface-400 inline-flex items-center gap-1">
                <Calendar class="size-3.5" />
                {{ t('applications.applied_label') }}
              </dt>
              <dd class="text-surface-700 dark:text-surface-200 font-medium">
                <TimelineDateLink :date="application.createdAt">{{ new Date(application.createdAt).toLocaleDateString() }}</TimelineDateLink>
              </dd>
            </div>
            <div>
              <dt class="text-surface-400 inline-flex items-center gap-1">
                <Clock class="size-3.5" />
                {{ t('applications.updated_label') }}
              </dt>
              <dd class="text-surface-700 dark:text-surface-200 font-medium">
                <TimelineDateLink :date="application.updatedAt">{{ new Date(application.updatedAt).toLocaleDateString() }}</TimelineDateLink>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <!-- Collaboration thread (заменил блок «Заметки») -->
      <div class="mt-4 mb-4" data-comment-composer>
        <ApplicationCommentThread :application-id="applicationId" />
      </div>

      <!-- Чат с кандидатом (Спринт 18) -->
      <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 mb-4">
        <div class="flex items-center gap-2 mb-3">
          <MessageSquare class="size-4 text-surface-500 dark:text-surface-400" />
          <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200">{{ t('dashboard.chat.tab') }}</h2>
        </div>
        <CommsChatPanel :application-id="applicationId" />
      </div>

      <!-- Custom properties (Notion-style) -->
      <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 mb-4">
        <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200 mb-2 px-2">{{ t('applications.properties') }}</h2>
        <PropertyBlock
          entity-type="application"
          :entity-id="applicationId"
          :job-id="application.job.id"
          :entries="(application.properties ?? []) as import('~~/shared/properties').PropertyEntry[]"
          @refresh="refresh()"
        />
      </div>

      <!-- Stage History Timeline — always show; the component renders its own empty state -->
      <div
        class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 mb-4"
      >
        <div class="flex items-center gap-2 mb-4">
          <GitBranch class="size-4 text-surface-500 dark:text-surface-400" />
          <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200">
            {{ $t('applications.history.title') }}
          </h2>
        </div>
        <ApplicationStageTimeline :application-id="applicationId" />
      </div>

      <!-- Question Responses -->
      <div
        v-if="application.responses && application.responses.length > 0"
        class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5"
      >
        <div class="flex items-center gap-2 mb-3">
          <FileText class="size-4 text-surface-500 dark:text-surface-400" />
          <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200">
            {{ t('applications.responses_count') }} ({{ application.responses.length }})
          </h2>
        </div>
        <div class="space-y-3">
          <div
            v-for="response in application.responses"
            :key="response.id"
            class="border-b border-surface-100 dark:border-surface-800 pb-3 last:border-0 last:pb-0"
          >
            <dt class="text-xs font-medium text-surface-500 dark:text-surface-400 mb-0.5">
              {{ response.question?.label ?? t('applications.unknown_question') }}
            </dt>
            <dd class="text-sm text-surface-700 dark:text-surface-200">
              {{ formatResponseValue(response.value) }}
            </dd>
          </div>
        </div>
      </div>
    </template>
  </div>

  <!-- Hotkey hint -->
  <div class="fixed bottom-4 left-4 z-40 hidden lg:flex items-center gap-1.5 rounded-full border border-surface-200 dark:border-surface-800 bg-white/80 dark:bg-surface-900/80 backdrop-blur-sm px-3 py-1.5 text-xs text-surface-400 dark:text-surface-500 shadow-sm">
    <Keyboard class="size-3.5" />
    <span>Нажмите <kbd class="font-mono font-semibold">?</kbd> для списка горячих клавиш</span>
  </div>

  <!-- Hotkeys modal -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      leave-active-class="transition-all duration-150 ease-in"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showHotkeysModal"
        class="fixed inset-0 z-[200] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Горячие клавиши"
        @click.self="showHotkeysModal = false"
      >
        <div class="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" @click="showHotkeysModal = false" />
        <div class="relative z-10 w-full max-w-sm rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-2xl p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <Keyboard class="size-5 text-surface-500" />
              <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Горячие клавиши</h2>
            </div>
            <button
              type="button"
              class="rounded-lg p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              aria-label="Закрыть"
              @click="showHotkeysModal = false"
            >
              <X class="size-4" />
            </button>
          </div>
          <ul class="space-y-2.5">
            <li class="flex items-center justify-between text-sm">
              <span class="text-surface-600 dark:text-surface-300">Открыть выбор этапа</span>
              <kbd class="rounded-md border border-surface-300 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-xs font-mono font-semibold text-surface-700 dark:text-surface-300">S</kbd>
            </li>
            <li class="flex items-center justify-between text-sm">
              <span class="text-surface-600 dark:text-surface-300">Фокус на заметках</span>
              <kbd class="rounded-md border border-surface-300 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-xs font-mono font-semibold text-surface-700 dark:text-surface-300">C</kbd>
            </li>
            <li class="flex items-center justify-between text-sm">
              <span class="text-surface-600 dark:text-surface-300">Показать подсказку</span>
              <kbd class="rounded-md border border-surface-300 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-xs font-mono font-semibold text-surface-700 dark:text-surface-300">?</kbd>
            </li>
          </ul>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Interview Schedule Sidebar -->
  <InterviewScheduleSidebar
    v-if="showInterviewSidebar && application"
    :application-id="applicationId"
    :candidate-name="`${application.candidate.firstName} ${application.candidate.lastName}`"
    :job-title="application.job.title"
    @close="showInterviewSidebar = false"
    @scheduled="showInterviewSidebar = false"
  />
</template>
