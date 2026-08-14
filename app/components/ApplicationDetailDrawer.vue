<script setup lang="ts">
/**
 * Полуокно (drawer) отклика.
 *
 * Спринт 13.3: приведено к полному паритету с полной страницей отклика —
 * этап воронки (ApplicationStagePicker), единый блок быстрых действий
 * (ApplicationQuickActions), русифицированные статусы. Legacy-статус
 * показывается только если у отклика нет этапа воронки.
 */
import { X, ExternalLink, User, Briefcase, Calendar, Clock, Hash, FileText, MessageSquare } from 'lucide-vue-next'
import ApplicationCommentThread from '~/components/Comments/ApplicationCommentThread.vue'
import CommsChatPanel from '~/components/Comms/CommsChatPanel.vue'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'
import { getApplicationSourceMeta } from '~/composables/useApplicationSource'

const props = defineProps<{
  applicationId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const localePath = useLocalePath()
const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const toast = useToast()

const { application, status: fetchStatus, error, refresh, updateApplication } = useApplication(() => props.applicationId)
const { formatCandidateName } = useOrgSettings()
const { t, te } = useI18n()

// ─── Этап воронки (как на полной странице) ────────────────────────────────────

const localStageId = ref<string | null>(null)
const localStageName = ref<string | null>(null)
const localStageColor = ref<string | null>(null)

watch(application, (app) => {
  if (app) {
    localStageId.value = (app as { currentStageId?: string | null }).currentStageId ?? null
    localStageName.value = (app as { currentStage?: { name: string } | null }).currentStage?.name ?? null
    localStageColor.value = (app as { currentStage?: { color: string } | null }).currentStage?.color ?? null
  }
}, { immediate: true })

function handleStageChanged(payload: { newStageId: string, newStageName: string, newStageColor: string }) {
  localStageId.value = payload.newStageId
  localStageName.value = payload.newStageName
  localStageColor.value = payload.newStageColor
  void refresh()
}

// ─── Legacy-переходы статуса (кнопки живут в ApplicationQuickActions) ─────────

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

// ─── Отображение ──────────────────────────────────────────────────────────────

const statusBadgeClasses: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  screening: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  interview: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  offer: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400',
  hired: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
  rejected: 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400',
}

/** Русифицированный лейбл legacy-статуса (единый источник — локали dashboard.applications.stages). */
function statusLabel(status: string): string {
  return te(`dashboard.applications.stages.${status}`) ? t(`dashboard.applications.stages.${status}`) : status
}

function formatResponseValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  return String(value ?? '—')
}

// ─── Скролл-лок и клавиатура ──────────────────────────────────────────────────

// Escape через единый LIFO-стек: при вложенных drawer'ах закрывается только верхний
useEscapeStack(true, () => emit('close'))

onMounted(() => { document.body.style.overflow = 'hidden' })
onUnmounted(() => { document.body.style.overflow = '' })
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        class="fixed inset-0 z-[55] bg-surface-900/40"
        @click="emit('close')"
      />
    </Transition>

    <!-- Panel -->
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      leave-active-class="transition-transform duration-200 ease-in"
      enter-from-class="translate-x-full"
      leave-to-class="translate-x-full"
    >
      <aside
        class="fixed inset-y-0 right-0 z-[60] w-full max-w-2xl flex flex-col bg-white dark:bg-surface-900 shadow-2xl border-l border-surface-200 dark:border-surface-800"
        role="dialog"
        aria-modal="true"
        aria-label="Карточка отклика"
      >
        <!-- Header -->
        <header class="flex items-center justify-between gap-3 px-5 py-4 border-b border-surface-200 dark:border-surface-800 shrink-0">
          <span class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">Карточка отклика</span>
          <div class="flex items-center gap-2 shrink-0">
            <NuxtLink
              :to="localePath(`/dashboard/applications/${applicationId}`)"
              class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            >
              <ExternalLink class="size-3.5" />
              Открыть полностью
            </NuxtLink>
            <button
              class="rounded-lg p-1.5 text-surface-500 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              @click="emit('close')"
            >
              <X class="size-4" />
            </button>
          </div>
        </header>

        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto p-5 space-y-4">
          <!-- Loading -->
          <DetailSkeleton v-if="fetchStatus === 'pending' && !application" :blocks="3" :with-header="false" />

          <!-- Error -->
          <EntityDetailError
            v-else-if="error"
            :title="error.statusCode === 404 ? t('applications.not_found') : t('applications.failed_to_load')"
            :on-retry="error.statusCode === 404 ? undefined : () => refresh()"
            :on-close="() => $emit('close')"
          />

          <template v-else-if="application">
            <!-- Header card -->
            <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
              <p class="mb-2 text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">
                {{ $t('applications.overview') }}
              </p>
              <div class="mb-2 flex flex-wrap items-center gap-2 text-surface-400">
                <h2 class="text-2xl font-bold text-surface-900 dark:text-surface-50 truncate">
                  {{ formatCandidateName(application.candidate) }}
                </h2>
                <span class="text-surface-400">→</span>
                <NuxtLink
                  :to="localePath(`/dashboard/jobs/${application.job.id}`)"
                  class="text-xl text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 truncate transition-colors"
                >
                  {{ application.job.title }}
                </NuxtLink>
              </div>
              <div class="flex flex-wrap items-center gap-3">
                <!-- Этап воронки — как на полной странице -->
                <ApplicationStagePicker
                  :application-id="applicationId"
                  :current-stage-id="localStageId"
                  @stage-changed="handleStageChanged"
                />
                <!-- Legacy-статус: показывается только если этап воронки не задан -->
                <span
                  v-if="!localStageId"
                  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                  :class="statusBadgeClasses[application.status] ?? 'bg-surface-100 text-surface-600'"
                >
                  {{ statusLabel(application.status) }}
                </span>
                <SourceBadge :source="(application as any).source" />
                <TimelineDateLink :date="application.createdAt" class="text-sm text-surface-500 dark:text-surface-400">
                  {{ t('applications.applied_label') }} {{ new Date(application.createdAt).toLocaleDateString() }}
                </TimelineDateLink>
              </div>
            </div>

            <!-- Quick actions — Спринт 13.3: единый компонент (карточка + полуокно) -->
            <ApplicationQuickActions
              :application-id="applicationId"
              :current-stage-id="localStageId"
              :status="application.status"
              :disabled="isTransitioning"
              @stage-changed="handleStageChanged"
              @legacy-transition="handleTransition"
              @schedule="showInterviewSidebar = true"
            />

            <!-- Candidate & Job cards -->
            <div class="grid gap-4 sm:grid-cols-2">
              <!-- Candidate info -->
              <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
                <div class="flex items-center gap-2 mb-3">
                  <User class="size-4 text-surface-500 dark:text-surface-400" />
                  <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-200">{{ t('applications.candidate') }}</h3>
                </div>
                <dl class="grid grid-cols-1 gap-3 text-sm">
                  <div>
                    <dt class="text-surface-400">{{ t('applications.name') }}</dt>
                    <dd class="text-surface-700 dark:text-surface-200 font-medium">
                      <NuxtLink
                        :to="localePath(`/dashboard/candidates/${application.candidate.id}`)"
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
                    <dt class="text-surface-400">Телефон</dt>
                    <dd class="text-surface-700 dark:text-surface-200 font-medium">{{ application.candidate.phone }}</dd>
                  </div>
                </dl>
              </div>

              <!-- Job info -->
              <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
                <div class="flex items-center gap-2 mb-3">
                  <Briefcase class="size-4 text-surface-500 dark:text-surface-400" />
                  <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-200">Вакансия</h3>
                </div>
                <dl class="grid grid-cols-1 gap-3 text-sm">
                  <div>
                    <dt class="text-surface-400">Название</dt>
                    <dd class="text-surface-700 dark:text-surface-200 font-medium">
                      <NuxtLink
                        :to="localePath(`/dashboard/jobs/${application.job.id}`)"
                        class="text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
                      >
                        {{ application.job.title }}
                      </NuxtLink>
                    </dd>
                  </div>
                  <div>
                    <dt class="text-surface-400">Статус вакансии</dt>
                    <dd class="text-surface-700 dark:text-surface-200 font-medium capitalize">{{ application.job.status }}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <!-- Application details -->
            <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
              <div class="flex items-center gap-2 mb-3">
                <Hash class="size-4 text-surface-500 dark:text-surface-400" />
                <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-200">{{ t('applications.details') }}</h3>
              </div>
              <dl class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt class="text-surface-400">{{ t('applications.score') }}</dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium">{{ application.score ?? '—' }}</dd>
                </div>
                <div v-if="localStageId">
                  <dt class="text-surface-400">{{ $t('applications.stage.current') }}</dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium">
                    <ApplicationStageBadge
                      :name="localStageName ?? ''"
                      :color="localStageColor ?? '#94a3b8'"
                      size="sm"
                    />
                  </dd>
                </div>
                <div v-else>
                  <dt class="text-surface-400">{{ t('applications.status') }}</dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium">{{ statusLabel(application.status) }}</dd>
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

            <!-- Collaboration thread (compact) -->
            <ApplicationCommentThread
              :application-id="applicationId"
              :compact="true"
            />

            <!-- Чат с кандидатом (Спринт 18) -->
            <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
              <div class="flex items-center gap-2 mb-3">
                <MessageSquare class="size-4 text-surface-500 dark:text-surface-400" />
                <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-200">{{ t('dashboard.chat.tab') }}</h3>
              </div>
              <CommsChatPanel :application-id="applicationId" />
            </div>

            <!-- Properties -->
            <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4">
              <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-200 mb-2 px-2">Свойства</h3>
              <PropertyBlock
                entity-type="application"
                :entity-id="applicationId"
                :job-id="application.job.id"
                :entries="(application.properties ?? []) as import('~~/shared/properties').PropertyEntry[]"
                @refresh="refresh()"
              />
            </div>

            <!-- Question Responses -->
            <div
              v-if="application.responses && application.responses.length > 0"
              class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5"
            >
              <div class="flex items-center gap-2 mb-3">
                <FileText class="size-4 text-surface-500 dark:text-surface-400" />
                <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-200">
                  Ответы на вопросы анкеты ({{ application.responses.length }})
                </h3>
              </div>
              <div class="space-y-3">
                <div
                  v-for="response in application.responses"
                  :key="response.id"
                  class="border-b border-surface-100 dark:border-surface-800 pb-3 last:border-0 last:pb-0"
                >
                  <dt class="text-xs font-medium text-surface-500 dark:text-surface-400 mb-0.5">
                    {{ response.question?.label ?? 'Вопрос не найден' }}
                  </dt>
                  <dd class="text-sm text-surface-700 dark:text-surface-200">
                    {{ formatResponseValue(response.value) }}
                  </dd>
                </div>
              </div>
            </div>
          </template>
        </div>
      </aside>
    </Transition>

    <!-- Nested interview scheduling sidebar -->
    <InterviewScheduleSidebar
      v-if="showInterviewSidebar && application"
      :application-id="applicationId"
      :candidate-name="`${application.candidate.firstName} ${application.candidate.lastName}`"
      :job-title="application.job.title"
      @close="showInterviewSidebar = false"
      @scheduled="showInterviewSidebar = false"
    />
  </Teleport>
</template>
