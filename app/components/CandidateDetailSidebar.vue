<script setup lang="ts">
import {
  X, User, Calendar, Clock, Hash, MessageSquare, FileText,
  ExternalLink, Mail, Phone, Upload, Download, Eye, Trash2,
  ArrowLeft, AlertTriangle, Brain, History, RefreshCw,
} from 'lucide-vue-next'
import CommsChatPanel from '~/components/Comms/CommsChatPanel.vue'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'

const props = defineProps<{
  applicationId: string
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'updated'): void
}>()

const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const toast = useToast()
const { track } = useTrack()
const { t, te } = useI18n()
const { formatCandidateName } = useOrgSettings()

// Detect if the job sub-nav bar is visible (adds 40px / 2.5rem)
const route = useRoute()
const getRouteBaseName = useRouteBaseName()
const hasSubNav = computed(() => {
  const baseName = getRouteBaseName(route)
  if (typeof baseName !== 'string') return false
  const idParam = route.params.id
  return baseName.startsWith('dashboard-jobs-id') && typeof idParam === 'string' && idParam !== 'new'
})

// ─────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────

const activeTab = ref<'overview' | 'documents' | 'responses' | 'ai_analysis' | 'timeline' | 'chat'>('overview')

// ─────────────────────────────────────────────
// Fetch application detail
// ─────────────────────────────────────────────

const { data: application, status: fetchStatus, refresh } = useFetch(
  () => `/api/applications/${props.applicationId}`,
  {
    key: computed(() => `sidebar-application-${props.applicationId}`),
    headers: useRequestHeaders(['cookie']),
    watch: [() => props.applicationId],
  },
)

// ─────────────────────────────────────────────
// Fetch full candidate detail (for documents)
// ─────────────────────────────────────────────

const candidateId = computed(() => application.value?.candidate?.id ?? null)

const { data: candidateData, refresh: refreshCandidate } = useFetch(
  () => candidateId.value ? `/api/candidates/${candidateId.value}` : null!,
  {
    key: computed(() => `sidebar-candidate-${candidateId.value}`),
    headers: useRequestHeaders(['cookie']),
    watch: [candidateId],
    immediate: false,
  },
)

// Fetch candidate data when application loads
watch(candidateId, (id) => {
  if (id) refreshCandidate()
}, { immediate: true })

const documents = computed(() => candidateData.value?.documents ?? [])

// ─────────────────────────────────────────────
// Действия по отклику — единый блок ApplicationQuickActions (этапы воронки;
// legacy-переходы статуса — только фолбэк для вакансий без воронки)
// ─────────────────────────────────────────────

const isTransitioning = ref(false)

async function handleStageChanged(payload: { newStageId: string, newStageName: string, newStageColor: string }) {
  track('sidebar_stage_changed', {
    application_id: props.applicationId,
    to_stage: payload.newStageId,
  })
  await refresh()
  emit('updated')
}

async function handleTransition(newStatus: string) {
  isTransitioning.value = true
  try {
    await $fetch(`/api/applications/${props.applicationId}`, {
      method: 'PATCH',
      body: { status: newStatus },
    })
    track('sidebar_status_changed', {
      application_id: props.applicationId,
      from_status: application.value?.status,
      to_status: newStatus,
    })
    await refresh()
    emit('updated')
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Не удалось изменить статус', { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
  } finally {
    isTransitioning.value = false
  }
}

// ─────────────────────────────────────────────
// Notes editing
// ─────────────────────────────────────────────

const isEditingNotes = ref(false)
const notesInput = ref('')
const isSavingNotes = ref(false)

function startEditNotes() {
  notesInput.value = application.value?.notes ?? ''
  isEditingNotes.value = true
}

async function saveNotes() {
  isSavingNotes.value = true
  try {
    await $fetch(`/api/applications/${props.applicationId}`, {
      method: 'PATCH',
      body: { notes: notesInput.value || null },
    })
    await refresh()
    emit('updated')
    isEditingNotes.value = false
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Не удалось сохранить заметки', { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
  } finally {
    isSavingNotes.value = false
  }
}

// ─────────────────────────────────────────────
// Documents — upload, download, preview, delete
// ─────────────────────────────────────────────

const { uploadDocument, downloadDocument, getPreviewUrl, deleteDocument } = useDocuments()

const fileInput = ref<HTMLInputElement | null>(null)
const selectedDocType = ref<'resume' | 'cover_letter' | 'other'>('resume')
const isUploading = ref(false)
const uploadError = ref<string | null>(null)
const showDocDeleteConfirm = ref<string | null>(null)
const isDeletingDoc = ref(false)
const reparsingDocId = ref<string | null>(null)

const showPreview = ref(false)
const previewUrl = ref<string | null>(null)
const previewFilename = ref('')
const previewMimeType = ref('')
const previewDocId = ref<string | null>(null)
const isLoadingPreview = ref(false)
const previewError = ref<string | null>(null)

const isPdfPreview = computed(() => previewMimeType.value === 'application/pdf')

const documentTypeLabels: Record<string, string> = {
  resume: 'Резюме',
  cover_letter: 'Сопроводительное письмо',
  other: 'Другое',
}

function triggerFileSelect() {
  fileInput.value?.click()
}

async function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !candidateId.value) return

  uploadError.value = null
  isUploading.value = true

  try {
    await uploadDocument(candidateId.value, file, selectedDocType.value)
    await refreshCandidate()
  } catch (err: any) {
    uploadError.value = err.data?.statusMessage ?? err.statusMessage ?? 'Загрузка не удалась'
  } finally {
    isUploading.value = false
    input.value = ''
  }
}

async function handleReparse(docId: string) {
  reparsingDocId.value = docId
  try {
    await $fetch(`/api/documents/${docId}/parse`, {
      method: 'POST',
      headers: useRequestHeaders(['cookie']),
    })
    toast.add({ title: 'Резюме успешно обработано', type: 'success' })
    await refreshCandidate()
  } catch (err: any) {
    toast.add({
      title: 'Не удалось обработать файл',
      message: err?.data?.statusMessage ?? 'Не удалось извлечь текст из документа.',
      type: 'error',
    })
  } finally {
    reparsingDocId.value = null
  }
}

async function handlePreview(docId: string, mimeType?: string) {
  // Only PDFs can be previewed inline — for DOC/DOCX, download directly
  if (mimeType && mimeType !== 'application/pdf') {
    await handleDownload(docId)
    return
  }

  previewError.value = null
  showPreview.value = true
  previewDocId.value = docId

  // Find the document name from the loaded data
  const doc = documents.value?.find((d: any) => d.id === docId)
  previewFilename.value = doc?.originalFilename ?? 'Документ'
  previewMimeType.value = doc?.mimeType ?? 'application/pdf'

  // Use the API endpoint URL directly — server streams the PDF (same-origin)
  previewUrl.value = getPreviewUrl(docId)
}

function closePreview() {
  showPreview.value = false
  previewUrl.value = null
  previewFilename.value = ''
  previewMimeType.value = ''
  previewDocId.value = null
  previewError.value = null
}

async function handleDownload(docId: string) {
  try {
    track('document_downloaded', { document_id: docId })
    await downloadDocument(docId)
  } catch {
    toast.error('Не удалось скачать документ')
  }
}

async function handleDeleteDoc(docId: string) {
  if (!candidateId.value) return
  isDeletingDoc.value = true
  try {
    await deleteDocument(docId, candidateId.value)
    await refreshCandidate()
    showDocDeleteConfirm.value = null
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Не удалось удалить документ', { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
  } finally {
    isDeletingDoc.value = false
  }
}

// ─────────────────────────────────────────────
// Escape key to close (layered: preview → delete → sidebar)
// ─────────────────────────────────────────────

// LIFO-стек Escape: sidebar → delete confirm → preview.
// Самый верхний слой закрывается первым — sidebar последним.
useEscapeStack(true, () => emit('close'))
useEscapeStack(showDocDeleteConfirm as unknown as import('vue').Ref<boolean>, () => { showDocDeleteConfirm.value = null })
useEscapeStack(showPreview, () => closePreview())

// ─────────────────────────────────────────────
// Timeline data for the candidate
// ─────────────────────────────────────────────

interface TimelineEntry {
  id: string
  action: string
  resourceType: string
  resourceId: string
  metadata: Record<string, unknown> | null
  createdAt: string
  actorName: string | null
  actorEmail: string | null
  resourceName: string | null
  jobTitle: string | null
  candidateName: string | null
}

const timelineItems = ref<TimelineEntry[]>([])
const timelineLoading = ref(false)
const timelineError = ref<string | null>(null)
const timelineLoaded = ref(false)

const timelineActionLabels: Record<string, string> = {
  created: 'Создано',
  updated: 'Обновлено',
  deleted: 'Удалено',
  status_changed: 'Статус изменён',
  stage_changed: 'Этап изменён',
  comment_added: 'Добавлен комментарий',
  scored: 'Оценено',
  scheduled: 'Запланировано',
}

function formatTimelineDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getTimelineActionColor(action: string): string {
  switch (action) {
    case 'created': return 'bg-green-500'
    case 'status_changed': return 'bg-blue-500'
    case 'stage_changed': return 'bg-brand-500'
    case 'updated': return 'bg-amber-500'
    case 'deleted': return 'bg-danger-500'
    case 'comment_added': return 'bg-violet-500'
    case 'scored': return 'bg-teal-500'
    case 'scheduled': return 'bg-brand-500'
    default: return 'bg-surface-400'
  }
}

function describeTimelineItem(item: TimelineEntry): string {
  const actor = item.actorName ?? item.actorEmail ?? 'Система'
  const action = timelineActionLabels[item.action] ?? item.action
  const resource = item.resourceType

  if ((item.action === 'status_changed' || item.action === 'stage_changed') && item.metadata) {
    const from = item.metadata.from_status ?? item.metadata.fromStatus ?? item.metadata.from
    const to = item.metadata.to_status ?? item.metadata.toStatus ?? item.metadata.to
    if (from && to) return `${actor}: ${from} → ${to}`
    if (to) return `${actor}: → ${to}`
  }

  if (item.action === 'scored' && item.metadata) {
    const score = item.metadata.score
    if (score != null) return `${actor} scored ${resource} — ${score} pts`
  }

  return `${actor} ${action.toLowerCase()} ${resource}`
}

async function loadTimeline() {
  if (!candidateId.value) return
  timelineLoading.value = true
  timelineError.value = null
  try {
    const result = await $fetch<{ items: TimelineEntry[] }>('/api/activity-log/candidate-timeline', {
      query: { candidateId: candidateId.value },
    })
    timelineItems.value = result.items
    timelineLoaded.value = true
  } catch (err: any) {
    timelineError.value = err?.data?.statusMessage ?? 'Не удалось загрузить ленту'
  } finally {
    timelineLoading.value = false
  }
}

// Load timeline data lazily when tab is selected
watch(activeTab, (tab) => {
  if (tab === 'timeline' && !timelineLoaded.value && candidateId.value) {
    loadTimeline()
  }
})


// Чат вынесен в общий компонент CommsChatPanel (Спринт 18)
const chatUnread = ref(0)

// Reset state when switching to a different application
watch(() => props.applicationId, () => {
  isEditingNotes.value = false
  activeTab.value = 'overview'
  uploadError.value = null
  showDocDeleteConfirm.value = null
  timelineItems.value = []
  timelineLoaded.value = false
  timelineError.value = null
  chatUnread.value = 0
  closePreview()
})

// ─────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────

function formatResponseValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  return String(value ?? '—')
}

const responsesCount = computed(() => application.value?.responses?.length ?? 0)

// ─────────────────────────────────────────────
// Interview scheduling & existing interviews
// ─────────────────────────────────────────────

const showScheduleSidebar = ref(false)

const { interviews: applicationInterviews, refresh: refreshInterviews } = useInterviews({
  applicationId: computed(() => props.applicationId),
})

// После планирования интервью — синхронизируем список интервью, данные
// отклика (этап мог смениться) и родительский список
async function handleInterviewScheduled() {
  showScheduleSidebar.value = false
  await Promise.all([refreshInterviews(), refresh()])
  emit('updated')
}

const interviewTypeLabels: Record<string, string> = {
  phone: 'Телефонное',
  video: 'Видео',
  in_person: 'Очное',
  panel: 'Панельное',
  technical: 'Техническое',
  take_home: 'Тестовое задание',
}

function formatInterviewDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <Transition name="slide">
    <aside
      v-if="open"
      class="fixed right-0 z-40 w-full sm:w-[640px] sm:max-w-[calc(100vw-4rem)] border-l border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-900 shadow-xl flex flex-col"
      :class="hasSubNav ? 'top-24 h-[calc(100vh-6rem)]' : 'top-14 h-[calc(100vh-3.5rem)]'"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-surface-200/80 dark:border-surface-800/60 px-4 sm:px-6 py-4 shrink-0">
        <div v-if="application" class="min-w-0 flex-1">
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center size-10 rounded-full bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-400 font-semibold text-sm shrink-0">
              {{ application.candidate.firstName[0] }}{{ application.candidate.lastName[0] }}
            </div>
            <div class="min-w-0">
              <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-50 truncate">
                {{ formatCandidateName(application.candidate) }}
              </h2>
              <div class="flex items-center gap-3 text-sm text-surface-500 dark:text-surface-400">
                <a
                  :href="`mailto:${application.candidate.email}`"
                  target="_blank"
                  class="inline-flex items-center gap-1 truncate hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
                >
                  <Mail class="size-3.5 shrink-0" />
                  {{ application.candidate.email }}
                </a>
                <span v-if="application.candidate.phone" class="inline-flex items-center gap-1">
                  <Phone class="size-3.5 shrink-0" />
                  {{ application.candidate.phone }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="min-w-0">
          <h2 class="text-lg font-semibold text-surface-400">Загрузка…</h2>
        </div>
        <div class="flex items-center gap-1 shrink-0 ml-3">
          <button
            class="rounded-md p-1.5 text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:text-surface-300 dark:hover:bg-surface-800 transition-colors"
            title="Закрыть (Esc)"
            @click="emit('close')"
          >
            <X class="size-5" />
          </button>
        </div>
      </div>

      <!-- Tabs -->
      <div v-if="application" class="px-4 sm:px-6 shrink-0">
        <DetailTabs
          v-model="activeTab"
          :tabs="[
            { key: 'overview', label: 'Обзор' },
            { key: 'ai_analysis', label: 'ИИ-анализ' },
            { key: 'documents', label: 'Документы', count: documents.length },
            { key: 'responses', label: 'Ответы', count: responsesCount },
            { key: 'chat', label: 'Чат', count: chatUnread > 0 ? chatUnread : null },
            { key: 'timeline', label: 'Активность' },
          ]"
        />
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
        <!-- Loading -->
        <DetailSkeleton v-if="fetchStatus === 'pending' && !application" :blocks="3" :with-header="false" />

        <!-- Error -->
        <EntityDetailError
          v-else-if="fetchStatus === 'error'"
          :message="'Не удалось получить данные отклика. Проверьте соединение и повторите.'"
          :on-retry="() => refresh()"
          :on-close="() => $emit('close')"
        />

        <template v-else-if="application">

          <!-- ═══════════════════════════════════════ -->
          <!-- OVERVIEW TAB                            -->
          <!-- ═══════════════════════════════════════ -->
          <div v-if="activeTab === 'overview'" class="space-y-5">
            <!-- Status & transitions -->
            <div>
              <div class="flex items-center gap-2 mb-3">
                <ApplicationStageBadge
                  v-if="application.currentStage"
                  :name="application.currentStage.name"
                  :color="application.currentStage.color"
                />
                <StatusBadge v-else :status="application.status" />
                <span class="text-sm text-surface-400">
                  {{ t('applications.applied_label') }} {{ new Date(application.createdAt).toLocaleDateString() }}
                </span>
              </div>

              <!-- Единые быстрые действия по этапам воронки (как в воронке и на странице отклика) -->
              <ApplicationQuickActions
                :application-id="props.applicationId"
                :current-stage-id="application.currentStageId ?? null"
                :status="application.status"
                :disabled="isTransitioning"
                @stage-changed="handleStageChanged"
                @legacy-transition="handleTransition"
                @schedule="showScheduleSidebar = true"
              />
            </div>

            <!-- Candidate info -->
            <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-5 shadow-sm shadow-surface-900/[0.03] dark:shadow-none">
              <div class="flex items-center gap-2.5 mb-4">
                <div class="flex size-7 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-950/40">
                  <User class="size-3.5 text-brand-600 dark:text-brand-400" />
                </div>
                <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ t('applications.candidate') }}</h3>
              </div>
              <dl class="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt class="text-xs font-medium text-surface-400 dark:text-surface-500 mb-1">{{ t('applications.name') }}</dt>
                  <dd class="text-surface-800 dark:text-surface-200 font-medium">
                    {{ formatCandidateName(application.candidate) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-xs font-medium text-surface-400 dark:text-surface-500 mb-1">{{ t('applications.email') }}</dt>
                  <dd class="text-surface-800 dark:text-surface-200 font-medium truncate">
                    <a
                      :href="`mailto:${application.candidate.email}`"
                      target="_blank"
                      class="hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
                    >{{ application.candidate.email }}</a>
                  </dd>
                </div>
                <div v-if="application.candidate.phone">
                  <dt class="text-xs font-medium text-surface-400 dark:text-surface-500 mb-1">{{ t('applications.phone') }}</dt>
                  <dd class="text-surface-800 dark:text-surface-200 font-medium">
                    {{ application.candidate.phone }}
                  </dd>
                </div>
              </dl>
            </div>

            <!-- Application details -->
            <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-5 shadow-sm shadow-surface-900/[0.03] dark:shadow-none">
              <div class="flex items-center gap-2.5 mb-4">
                <div class="flex size-7 items-center justify-center rounded-lg bg-info-50 dark:bg-info-950/40">
                  <Hash class="size-3.5 text-info-600 dark:text-info-400" />
                </div>
                <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ t('applications.details') }}</h3>
              </div>
              <dl class="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt class="text-xs font-medium text-surface-400 dark:text-surface-500 mb-1">{{ t('applications.score') }}</dt>
                  <dd>
                    <ScoreBadge :score="application.score" size="sm" />
                  </dd>
                </div>
                <div>
                  <dt class="text-xs font-medium text-surface-400 dark:text-surface-500 mb-1">{{ t('applications.status') }}</dt>
                  <dd>
                    <StatusBadge :status="application.status as any" size="sm" />
                  </dd>
                </div>
                <div>
                  <dt class="text-xs font-medium text-surface-400 dark:text-surface-500 mb-1 inline-flex items-center gap-1">
                    <Calendar class="size-3.5" />
                    {{ t('applications.applied_label') }}
                  </dt>
                  <dd class="text-surface-800 dark:text-surface-200 font-medium">
                    {{ new Date(application.createdAt).toLocaleDateString() }}
                  </dd>
                </div>
                <div>
                  <dt class="text-xs font-medium text-surface-400 dark:text-surface-500 mb-1 inline-flex items-center gap-1">
                    <Clock class="size-3.5" />
                    {{ t('applications.updated_label') }}
                  </dt>
                  <dd class="text-surface-800 dark:text-surface-200 font-medium">
                    {{ new Date(application.updatedAt).toLocaleDateString() }}
                  </dd>
                </div>
              </dl>
            </div>

            <!-- Notes -->
            <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-5 shadow-sm shadow-surface-900/[0.03] dark:shadow-none">
              <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-2.5">
                  <div class="flex size-7 items-center justify-center rounded-lg bg-warning-50 dark:bg-warning-950/40">
                    <MessageSquare class="size-3.5 text-warning-600 dark:text-warning-400" />
                  </div>
                  <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ t('applications.notes') }}</h3>
                </div>
                <button
                  v-if="!isEditingNotes"
                  class="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 font-medium transition-colors"
                  @click="startEditNotes"
                >
                  {{ application.notes ? t('applications.edit_notes') : t('applications.add_notes') }}
                </button>
              </div>

              <div v-if="isEditingNotes">
                <textarea
                  v-model="notesInput"
                  rows="4"
                  placeholder="Добавьте заметки об этом отклике…"
                  class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                />
                <div class="flex items-center gap-2 mt-2">
                  <button
                    :disabled="isSavingNotes"
                    class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                    @click="saveNotes"
                  >
                    {{ isSavingNotes ? t('applications.saving') : t('applications.save') }}
                  </button>
                  <button
                    class="rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                    @click="isEditingNotes = false"
                  >
                    {{ t('applications.cancel') }}
                  </button>
                </div>
              </div>

              <p
                v-else-if="application.notes"
                class="text-sm leading-relaxed text-surface-600 dark:text-surface-300 whitespace-pre-wrap"
              >
                {{ application.notes }}
              </p>
              <p v-else class="text-sm text-surface-400 italic">{{ t('applications.no_notes') }}</p>
            </div>

            <!-- Scheduled interviews -->
            <div v-if="applicationInterviews.length > 0" class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-5 shadow-sm shadow-surface-900/[0.03] dark:shadow-none">
              <div class="flex items-center gap-2.5 mb-4">
                <div class="flex size-7 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
                  <Calendar class="size-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">Интервью</h3>
              </div>
              <div class="space-y-3">
                <div
                  v-for="iv in applicationInterviews"
                  :key="iv.id"
                  class="rounded-lg border border-surface-200/60 dark:border-surface-800/40 p-3"
                >
                  <div class="flex items-center justify-between mb-1">
                    <NuxtLink
                      :to="$localePath(`/dashboard/interviews/${iv.id}`)"
                      class="text-sm font-medium text-surface-800 dark:text-surface-200 hover:text-brand-600 dark:hover:text-brand-400 transition-colors truncate"
                    >
                      {{ iv.title }}
                    </NuxtLink>
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize shrink-0 ml-2"
                      :class="{
                        'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400': iv.status === 'scheduled',
                        'bg-success-50 text-success-700 dark:bg-success-950/40 dark:text-success-400': iv.status === 'completed',
                        'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400': iv.status === 'cancelled' || iv.status === 'no_show',
                      }"
                    >
                      {{ iv.status === 'no_show' ? 'Не явился' : iv.status }}
                    </span>
                  </div>
                  <div class="flex items-center gap-2 text-xs text-surface-400 dark:text-surface-500">
                    <span class="font-medium">{{ formatInterviewDate(iv.scheduledAt) }}</span>
                    <span class="text-surface-200 dark:text-surface-700">&middot;</span>
                    <span>{{ interviewTypeLabels[iv.type] ?? iv.type }}</span>
                    <span class="text-surface-200 dark:text-surface-700">&middot;</span>
                    <span>{{ iv.duration }} min</span>
                  </div>
                  <div class="mt-2">
                    <a
                      v-if="iv.googleCalendarEventLink"
                      :href="iv.googleCalendarEventLink"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors"
                    >
                      <Calendar class="size-2.5" />
                      Открыть в Google Calendar
                      <ExternalLink class="size-2" />
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <!-- Quick links -->
            <div class="flex items-center gap-4 pt-1">
              <NuxtLink
                :to="$localePath(`/dashboard/candidates/${application.candidate.id}`)"
                class="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 font-medium transition-colors"
              >
                <ExternalLink class="size-3.5" />
                Полный профиль кандидата
              </NuxtLink>
              <NuxtLink
                :to="$localePath(`/dashboard/applications/${application.id}`)"
                class="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 font-medium transition-colors"
              >
                <ExternalLink class="size-3.5" />
                Страница отклика
              </NuxtLink>
            </div>
          </div>

          <!-- ═══════════════════════════════════════ -->
          <!-- DOCUMENTS TAB                           -->
          <!-- ═══════════════════════════════════════ -->
          <div v-if="activeTab === 'documents'" class="space-y-4">
            <!-- Hidden file input -->
            <input
              ref="fileInput"
              type="file"
              accept=".pdf,.doc,.docx"
              class="hidden"
              @change="handleFileSelected"
            />

            <!-- ── Inline PDF preview (replaces document list when active) ── -->
            <template v-if="showPreview">
              <!-- Preview toolbar -->
              <div class="flex items-center justify-between">
                <button
                  class="inline-flex items-center gap-1.5 text-sm font-medium text-surface-600 dark:text-surface-300 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                  @click="closePreview"
                >
                  <ArrowLeft class="size-3.5" />
                  Назад к документам
                </button>
                <div class="flex items-center gap-1">
                  <button
                    v-if="previewDocId"
                    class="rounded-lg p-1.5 text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                    title="Скачать"
                    @click="handleDownload(previewDocId!)"
                  >
                    <Download class="size-4" />
                  </button>
                </div>
              </div>

              <!-- Filename -->
              <div v-if="previewFilename" class="flex items-center gap-2">
                <FileText class="size-4 text-surface-400 shrink-0" />
                <span class="text-sm font-medium text-surface-700 dark:text-surface-200 truncate">
                  {{ previewFilename }}
                </span>
              </div>

              <!-- Error state -->
              <div
                v-if="previewError"
                class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-6 text-center"
              >
                <AlertTriangle class="size-8 text-danger-400 mx-auto mb-2" />
                <p class="text-sm text-danger-700 dark:text-danger-400">{{ previewError }}</p>
                <button
                  class="mt-3 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium"
                  @click="closePreview"
                >
                  Назад
                </button>
              </div>

              <!-- PDF iframe — same-origin, server streams the bytes -->
              <iframe
                v-else-if="previewUrl && isPdfPreview"
                :src="previewUrl"
                class="w-full rounded-lg border border-surface-200 dark:border-surface-800"
                style="height: calc(100vh - 280px);"
                title="Просмотр документа"
              />
            </template>

            <!-- ── Document list (normal state) ── -->
            <template v-else>
              <!-- Upload controls -->
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <select
                    v-model="selectedDocType"
                    class="rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-sm text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="resume">Резюме</option>
                    <option value="cover_letter">Сопроводительное письмо</option>
                    <option value="other">Другое</option>
                  </select>
                </div>
                <button
                  :disabled="isUploading"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  @click="triggerFileSelect"
                >
                  <Upload class="size-3.5" />
                  {{ isUploading ? 'Загрузка…' : 'Загрузить документ' }}
                </button>
              </div>

              <!-- Upload error -->
              <div
                v-if="uploadError"
                class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400"
              >
                {{ uploadError }}
                <button class="underline ml-1" @click="uploadError = null">Закрыть</button>
              </div>

              <!-- Empty state -->
              <div
                v-if="documents.length === 0"
                class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-8 text-center shadow-sm shadow-surface-900/[0.03] dark:shadow-none"
              >
                <div class="flex size-14 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                  <FileText class="size-6 text-surface-400 dark:text-surface-500" />
                </div>
                <p class="text-sm font-medium text-surface-600 dark:text-surface-300">Пока нет документов.</p>
                <p class="text-xs text-surface-400 dark:text-surface-500 mt-1">
                  Загрузите резюме, сопроводительное письмо или другой документ (PDF, DOC, DOCX — до 10 МБ).
                </p>
              </div>

              <!-- Document list -->
              <div v-else class="space-y-2">
                <div
                  v-for="doc in documents"
                  :key="doc.id"
                  class="group flex items-center justify-between rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 px-4 py-3 shadow-sm shadow-surface-900/[0.03] dark:shadow-none transition-colors"
                  :class="doc.mimeType === 'application/pdf' ? 'cursor-pointer hover:border-brand-300 dark:hover:border-brand-700 hover:bg-brand-50/50 dark:hover:bg-brand-950/30' : ''"
                  @click="doc.mimeType === 'application/pdf' ? handlePreview(doc.id, doc.mimeType) : undefined"
                >
                  <div class="flex items-center gap-3 min-w-0">
                    <FileText class="size-4 shrink-0" :class="doc.mimeType === 'application/pdf' ? 'text-danger-500 dark:text-danger-400' : 'text-surface-400'" />
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-surface-700 dark:text-surface-200 truncate">
                        {{ doc.originalFilename }}
                      </p>
                      <span class="text-xs text-surface-400">
                        {{ documentTypeLabels[doc.type] ?? doc.type }}
                        · {{ new Date(doc.createdAt).toLocaleDateString() }}
                        <template v-if="doc.parsed === false">
                          · <span class="text-warning-500 dark:text-warning-400">Не удалось извлечь текст</span>
                        </template>
                        <template v-else-if="doc.mimeType === 'application/pdf'"> · <span class="text-brand-500 dark:text-brand-400">Открыть предпросмотр</span></template>
                      </span>
                    </div>
                  </div>
                  <div class="flex items-center gap-1 shrink-0" @click.stop>
                    <button
                      v-if="doc.parsed === false"
                      :disabled="reparsingDocId === doc.id"
                      class="rounded-lg p-1.5 text-warning-500 hover:text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-50"
                      title="Повторить распознавание текста"
                      @click="handleReparse(doc.id)"
                    >
                      <RefreshCw class="size-4" :class="{ 'animate-spin': reparsingDocId === doc.id }" />
                    </button>
                    <button
                      v-if="doc.mimeType === 'application/pdf'"
                      class="rounded-lg p-1.5 text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                      title="Просмотреть PDF"
                      @click="handlePreview(doc.id, doc.mimeType)"
                    >
                      <Eye class="size-4" />
                    </button>
                    <button
                      class="rounded-lg p-1.5 text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                      title="Скачать"
                      @click="handleDownload(doc.id)"
                    >
                      <Download class="size-4" />
                    </button>
                    <button
                      class="rounded-lg p-1.5 text-surface-400 hover:text-danger-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                      title="Удалить"
                      @click="showDocDeleteConfirm = doc.id"
                    >
                      <Trash2 class="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </div>
          <!-- ═══════════════════════════════════════ -->
          <!-- RESPONSES TAB                           -->
          <!-- ═══════════════════════════════════════ -->
          <div v-if="activeTab === 'responses'" class="space-y-3">
            <div
              v-if="responsesCount === 0"
              class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-8 text-center shadow-sm shadow-surface-900/[0.03] dark:shadow-none"
            >
              <div class="flex size-14 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                <FileText class="size-6 text-surface-400 dark:text-surface-500" />
              </div>
              <p class="text-sm font-medium text-surface-600 dark:text-surface-300">Нет ответов на отклик.</p>
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="response in application.responses"
                :key="response.id"
                class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-4 shadow-sm shadow-surface-900/[0.03] dark:shadow-none"
              >
                <dt class="text-xs font-semibold text-surface-400 dark:text-surface-500 mb-1.5 uppercase tracking-wider">
                  {{ response.question?.label ?? 'Вопрос неизвестен' }}
                </dt>
                <dd class="text-sm text-surface-700 dark:text-surface-200 leading-relaxed">
                  {{ formatResponseValue(response.value) }}
                </dd>
              </div>
            </div>
          </div>

          <!-- ═══════════════════════════════════════ -->
          <!-- CHAT TAB (Спринт 18 — общий компонент)  -->
          <!-- ═══════════════════════════════════════ -->
          <div v-if="activeTab === 'chat'">
            <CommsChatPanel :application-id="props.applicationId" @meta="chatUnread = $event.unreadCount" />
          </div>

          <!-- ═══════════════════════════════════════ -->
          <!-- AI ANALYSIS TAB                         -->
          <!-- ═══════════════════════════════════════ -->
          <div v-if="activeTab === 'ai_analysis'">
            <ScoreBreakdown :application-id="props.applicationId" @scored="refresh(); emit('updated')" />
          </div>

          <!-- ═══════════════════════════════════════ -->
          <!-- TIMELINE TAB                            -->
          <!-- ═══════════════════════════════════════ -->
          <div v-if="activeTab === 'timeline'" class="space-y-1">
            <!-- Loading -->
            <div v-if="timelineLoading" class="text-center py-12 text-surface-400">
              <div class="size-6 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin mx-auto mb-3" />
              Загрузка ленты…
            </div>

            <!-- Error -->
            <div
              v-else-if="timelineError"
              class="rounded-xl border border-danger-200/80 dark:border-danger-800/60 bg-danger-50 dark:bg-danger-950/40 p-5 text-center"
            >
              <AlertTriangle class="size-6 text-danger-400 mx-auto mb-2" />
              <p class="text-sm text-danger-700 dark:text-danger-400">{{ timelineError }}</p>
              <button
                class="mt-3 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium"
                @click="loadTimeline"
              >
                Повторить
              </button>
            </div>

            <!-- Empty -->
            <div
              v-else-if="timelineItems.length === 0"
              class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-8 text-center shadow-sm shadow-surface-900/[0.03] dark:shadow-none"
            >
              <div class="flex size-14 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                <History class="size-6 text-surface-400 dark:text-surface-500" />
              </div>
              <p class="text-sm font-medium text-surface-600 dark:text-surface-300">Пока нет зафиксированных событий.</p>
              <p class="text-xs text-surface-400 dark:text-surface-500 mt-1">События этого кандидата появятся здесь.</p>
            </div>

            <!-- Timeline list -->
            <div v-else>
              <div
                v-for="(item, index) in timelineItems"
                :key="item.id"
                class="flex gap-3 py-2 group"
              >
                <!-- Dot + connector -->
                <div class="flex flex-col items-center shrink-0 mt-[3px]">
                  <div
                    class="size-[9px] rounded-full ring-2 ring-white dark:ring-surface-950 shrink-0"
                    :class="getTimelineActionColor(item.action)"
                  />
                  <div
                    v-if="index < timelineItems.length - 1"
                    class="w-px flex-1 min-h-[14px] bg-surface-200 dark:bg-surface-700 mt-1"
                  />
                </div>

                <!-- Content -->
                <div class="min-w-0 flex-1">
                  <p class="text-sm text-surface-700 dark:text-surface-200 leading-snug">
                    {{ describeTimelineItem(item) }}
                  </p>
                  <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-[11px] text-surface-400 dark:text-surface-500 tabular-nums">
                      {{ formatTimelineDate(item.createdAt) }}
                    </span>
                    <span
                      v-if="item.jobTitle"
                      class="text-[10px] text-surface-400 dark:text-surface-500 bg-surface-100 dark:bg-surface-800 rounded px-1.5 py-0.5 truncate max-w-[140px]"
                    >
                      {{ item.jobTitle }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </template>
      </div>
    </aside>
  </Transition>

  <!-- Interview Schedule Sidebar -->
  <InterviewScheduleSidebar
    v-if="showScheduleSidebar && application"
    :application-id="props.applicationId"
    :candidate-name="`${application.candidate.firstName} ${application.candidate.lastName}`"
    :job-title="application.job?.title ?? ''"
    @close="showScheduleSidebar = false"
    @scheduled="handleInterviewScheduled"
  />



  <!-- Document delete confirmation dialog -->
  <Teleport to="body">
    <div v-if="showDocDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/50" @click="showDocDeleteConfirm = null" />
      <div class="relative bg-white dark:bg-surface-900 rounded-2xl shadow-2xl shadow-surface-900/10 dark:shadow-black/30 ring-1 ring-surface-200/80 dark:ring-surface-700/60 p-6 max-w-sm w-full mx-4">
        <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-2">Удалить документ</h3>
        <p class="text-sm text-surface-600 dark:text-surface-400 mb-4">
          Удалить документ? Действие нельзя отменить.
        </p>
        <div class="flex justify-end gap-2">
          <button
            :disabled="isDeletingDoc"
            class="rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            @click="showDocDeleteConfirm = null"
          >
            Отмена
          </button>
          <button
            :disabled="isDeletingDoc"
            class="rounded-lg bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50 transition-colors"
            @click="handleDeleteDoc(showDocDeleteConfirm!)"
          >
            {{ isDeletingDoc ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
