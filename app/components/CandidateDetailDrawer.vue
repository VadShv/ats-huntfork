<script setup lang="ts">
import { X, ExternalLink, Mail, Phone, Calendar, Clock, Briefcase, FileText, Plus, Download, Eye, AlertTriangle, MapPin, Linkedin, Github, Send, MessageSquare, MoreHorizontal, Handshake, GitMerge, ShieldCheck } from 'lucide-vue-next'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'
import CommsChatPanel from '~/components/Comms/CommsChatPanel.vue'

const props = defineProps<{
  candidateId: string
  /** Контекст отклика — включает вкладку «Чат» (Спринт 18) */
  applicationId?: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

const localePath = useLocalePath()
const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const toast = useToast()
const isDrawerMoreOpen = ref(false)
const drawerReferralOpen = ref(false)
const drawerFraudOpen = ref(false)
const drawerMergeOpen = ref(false)
const drawerFraudForm = ref({ reason: 'blacklist', notes: '' })
const drawerIsUpdatingFraud = ref(false)
const drawerIsUpdatingManualOnly = ref(false)

const { candidate, status: fetchStatus, error, refresh } = useCandidate(() => props.candidateId)
const { formatCandidateName, formatDate } = useOrgSettings()
const { t, te } = useI18n()

// ── Действия меню «Другое» (аналогично полной странице) ──
async function drawerSubmitFraud() {
  if (drawerIsUpdatingFraud.value) return
  drawerIsUpdatingFraud.value = true
  try {
    await $fetch(`/api/candidates/${props.candidateId}/fraud-flag`, {
      method: 'POST',
      body: { flag: true, reason: drawerFraudForm.value.reason, notes: drawerFraudForm.value.notes || null },
    })
    await refresh()
    toast.success?.('Кандидат помечен фрод-флагом')
    drawerFraudOpen.value = false
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Не удалось выставить фрод-флаг')
  }
  finally { drawerIsUpdatingFraud.value = false }
}

async function drawerRemoveFraud() {
  if (drawerIsUpdatingFraud.value) return
  drawerIsUpdatingFraud.value = true
  try {
    await $fetch(`/api/candidates/${props.candidateId}/fraud-flag`, { method: 'POST', body: { flag: false } })
    await refresh()
    toast.success?.('Фрод-флаг снят')
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Не удалось снять фрод-флаг')
  }
  finally { drawerIsUpdatingFraud.value = false }
}

async function drawerToggleManualOnly() {
  if (!candidate.value || drawerIsUpdatingManualOnly.value) return
  const next = !(candidate.value as any).manualReviewOnly
  drawerIsUpdatingManualOnly.value = true
  try {
    await $fetch(`/api/candidates/${props.candidateId}`, { method: 'PATCH', body: { manualReviewOnly: next } })
    await refresh()
    toast.success?.(next ? 'Ручной режим включён' : 'Ручной режим выключен')
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Не удалось переключить ручной режим')
  }
  finally { drawerIsUpdatingManualOnly.value = false }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const activeTab = ref<'applications' | 'documents' | 'chat'>('applications')

// ─── Resume ───────────────────────────────────────────────────────────────────

// Документ-резюме для кнопки «Структурировать из файла» и превью оригинала.
// Критерий выровнен с полной страницей ([id].vue): требуем d.parsed, иначе
// панель резюме получала бы иной документ, чем на полной странице.
const resumeDoc = computed<{ id: string, mimeType?: string, previewAvailable?: boolean, originalFilename?: string } | null>(() => {
  const docs = (candidate.value as any)?.documents ?? []
  return docs.find((d: any) => d.type === 'resume' && d.parsed) ?? null
})
const resumeDocumentId = computed<string | null>(() => resumeDoc.value?.id ?? null)
const resumeDocumentMime = computed<string | null>(() => resumeDoc.value?.mimeType ?? null)
const resumeDocumentName = computed<string | null>(() => resumeDoc.value?.originalFilename ?? null)
const resumeDocumentPreviewAvailable = computed<boolean>(() => resumeDoc.value?.previewAvailable ?? false)

// ─── Apply to job modal ───────────────────────────────────────────────────────

const showApplyModal = ref(false)

function handleApplied() {
  showApplyModal.value = false
  refresh()
}

// ─── Interview scheduling ─────────────────────────────────────────────────────

const showInterviewSidebar = ref(false)
const interviewTargetApp = ref<{ id: string; jobTitle: string } | null>(null)

function openScheduleInterview(app: { id: string; job: { title: string } }) {
  interviewTargetApp.value = { id: app.id, jobTitle: app.job.title }
  showInterviewSidebar.value = true
}

// ─── Documents ────────────────────────────────────────────────────────────────

const { downloadDocument, getPreviewUrl } = useDocuments()

// Preview state
const showPreview = ref(false)
const previewUrl = ref<string | null>(null)
const previewFilename = ref('')
const previewMimeType = ref('')
const previewDocId = ref<string | null>(null)

const isPdfPreview = computed(() => previewMimeType.value === 'application/pdf')

async function handlePreview(docId: string, mimeType?: string) {
  if (mimeType && mimeType !== 'application/pdf') {
    await handleDownload(docId)
    return
  }
  showPreview.value = true
  previewDocId.value = docId
  const doc = candidate.value?.documents?.find((d: any) => d.id === docId)
  previewFilename.value = doc?.originalFilename ?? 'Document'
  previewMimeType.value = doc?.mimeType ?? 'application/pdf'
  previewUrl.value = getPreviewUrl(docId)
}

function closePreview() {
  showPreview.value = false
  previewUrl.value = null
  previewFilename.value = ''
  previewMimeType.value = ''
  previewDocId.value = null
}

// Parsed text preview state
const showTextPreview = ref(false)
const textPreviewFilename = ref('')
const parsedText = ref('')
const parsedSections = ref<{ heading: string; content: string }[]>([])
const isLoadingText = ref(false)

async function handleShowText(docId: string) {
  const doc = candidate.value?.documents?.find((d: any) => d.id === docId)
  showTextPreview.value = true
  showPreview.value = false
  textPreviewFilename.value = doc?.originalFilename ?? 'Документ'
  isLoadingText.value = true
  parsedText.value = ''
  parsedSections.value = []
  try {
    const data = await $fetch<{ text: string; sections: { heading: string; content: string }[] }>(`/api/documents/${docId}/parsed`, {
      headers: useRequestHeaders(['cookie']),
    })
    parsedText.value = data.text || ''
    parsedSections.value = data.sections || []
  } catch {
    toast.error('Не удалось загрузить текст документа')
    showTextPreview.value = false
  } finally {
    isLoadingText.value = false
  }
}

function closeTextPreview() {
  showTextPreview.value = false
  textPreviewFilename.value = ''
  parsedText.value = ''
  parsedSections.value = []
}

async function handleDownload(docId: string) {
  const filename = candidate.value?.documents?.find((d: any) => d.id === docId)?.originalFilename
  try {
    await downloadDocument(docId, filename)
  } catch {
    toast.error('Не удалось скачать документ')
  }
}

// ─── Display helpers ──────────────────────────────────────────────────────────

// Локализованный лейбл пола через i18n (RU). Fallback — сырое значение.
function genderLabel(gender: string): string {
  const key = `dashboard.candidates.gender.${gender}`
  return te(key) ? t(key) : gender
}

// Единый источник лейблов типов документов (candidate.documents.*) — как на
// полной странице и в sidebar, чтобы не расходились между поверхностями.
const documentTypeLabels = computed<Record<string, string>>(() => ({
  resume: t('candidate.documents.resume'),
  cover_letter: t('candidate.documents.cover_letter'),
  other: t('candidate.documents.other'),
}))

// ─── Body scroll lock + keyboard handling ─────────────────────────────────────

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
        aria-label="Карточка кандидата"
      >
        <!-- Header -->
        <header class="flex items-center justify-between gap-3 px-5 py-4 border-b border-surface-200 dark:border-surface-800 shrink-0">
          <span class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">Карточка кандидата</span>
          <div class="flex items-center gap-2 shrink-0">
            <NuxtLink
              :to="localePath(`/dashboard/candidates/${candidateId}`)"
              class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            >
              <ExternalLink class="size-3.5" />
              Полная страница
            </NuxtLink>
            <div class="relative">
              <button
                type="button"
                class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                @click="isDrawerMoreOpen = !isDrawerMoreOpen"
              >
                <MoreHorizontal class="size-3.5" />
                {{ t('candidate.detail.more') }}
              </button>
              <div
                v-if="isDrawerMoreOpen"
                class="absolute top-[calc(100%+4px)] right-0 min-w-[220px] bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg z-50 overflow-hidden"
              >
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors cursor-pointer"
                  @click="isDrawerMoreOpen = false; drawerReferralOpen = true"
                >
                  <Handshake class="size-4 shrink-0" />
                  <span>{{ t('candidate.detail.referralAction') }}</span>
                </button>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors cursor-pointer"
                  @click="isDrawerMoreOpen = false; drawerMergeOpen = true"
                >
                  <GitMerge class="size-4 shrink-0" />
                  <span>{{ t('candidate.detail.mergeAction') }}</span>
                </button>
                <button
                  v-if="!(candidate as any)?.fraudFlag"
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors cursor-pointer"
                  @click="isDrawerMoreOpen = false; drawerFraudForm = { reason: 'blacklist', notes: '' }; drawerFraudOpen = true"
                >
                  <AlertTriangle class="size-4 shrink-0" />
                  <span>{{ t('candidate.detail.fraudAction') }}</span>
                </button>
                <button
                  v-else
                  type="button"
                  :disabled="drawerIsUpdatingFraud"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors cursor-pointer disabled:opacity-50"
                  @click="isDrawerMoreOpen = false; drawerRemoveFraud()"
                >
                  <AlertTriangle class="size-4 shrink-0" />
                  <span>{{ t('candidate.detail.fraudRemoveAction') }}</span>
                </button>
                <button
                  type="button"
                  :disabled="drawerIsUpdatingManualOnly"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors cursor-pointer disabled:opacity-50"
                  :class="(candidate as any)?.manualReviewOnly
                    ? 'text-info-700 dark:text-info-300 bg-info-50/40 dark:bg-info-950/40 hover:bg-info-50 dark:hover:bg-info-950'
                    : 'text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800'"
                  @click="isDrawerMoreOpen = false; drawerToggleManualOnly()"
                >
                  <ShieldCheck class="size-4 shrink-0" />
                  <span>{{ (candidate as any)?.manualReviewOnly ? t('candidate.detail.manualReviewOnlyOn') : t('candidate.detail.manualReviewOnly') }}</span>
                </button>
              </div>
            </div>
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
          <div v-if="fetchStatus === 'pending'" class="text-center py-12 text-surface-400">
            Загружаем…
          </div>

          <!-- Error -->
          <div
            v-else-if="error"
            class="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700"
          >
            {{ error.statusCode === 404 ? 'Кандидат не найден.' : 'Не удалось загрузить кандидата.' }}
          </div>

          <template v-else-if="candidate">
            <!-- Header -->
            <div class="min-w-0">
              <h2 class="text-2xl font-bold text-surface-900 dark:text-surface-50 truncate mb-1">
                {{ formatCandidateName(candidate) }}
              </h2>
              <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-sm text-surface-500">
                <a
                  :href="`mailto:${candidate.email}`"
                  target="_blank"
                  class="inline-flex items-center gap-1 hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
                >
                  <Mail class="size-3.5" />
                  {{ candidate.email }}
                </a>
                <span v-if="candidate.phone" class="inline-flex items-center gap-1">
                  <Phone class="size-3.5" />
                  {{ candidate.phone }}
                </span>
              </div>
            </div>

            <!-- Contact details -->
            <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
              <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-200 mb-3">Контакты и профиль</h3>
              <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt class="text-surface-400">{{ t('dashboard.candidateDrawer.emailLabel') }}</dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium truncate">
                    <a
                      :href="`mailto:${candidate.email}`"
                      target="_blank"
                      class="hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
                    >{{ candidate.email }}</a>
                  </dd>
                </div>
                <div>
                  <dt class="text-surface-400">Телефон</dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium">{{ candidate.phone || '—' }}</dd>
                </div>
                <div v-if="(candidate as any).city">
                  <dt class="text-surface-400 inline-flex items-center gap-1">
                    <MapPin class="size-3.5" />Город
                  </dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium">{{ (candidate as any).city }}</dd>
                </div>
                <div v-if="candidate.gender">
                  <dt class="text-surface-400">Пол</dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium">
                    {{ genderLabel(candidate.gender) }}
                  </dd>
                </div>
                <div v-if="candidate.dateOfBirth">
                  <dt class="text-surface-400">Дата рождения</dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium">
                    {{ formatDate(candidate.dateOfBirth) }}
                  </dd>
                </div>
                <div v-if="(candidate as any).linkedin" class="sm:col-span-2">
                  <dt class="text-surface-400 inline-flex items-center gap-1">
                    <Linkedin class="size-3.5" />LinkedIn
                  </dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium truncate">
                    <a
                      :href="(candidate as any).linkedin.startsWith('http') ? (candidate as any).linkedin : `https://${(candidate as any).linkedin}`"
                      target="_blank"
                      class="hover:text-brand-600 dark:hover:text-brand-400 hover:underline"
                    >{{ (candidate as any).linkedin }}</a>
                  </dd>
                </div>
                <div v-if="(candidate as any).telegram">
                  <dt class="text-surface-400 inline-flex items-center gap-1">
                    <Send class="size-3.5" />Telegram
                  </dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium truncate">
                    <a
                      :href="`https://t.me/${(candidate as any).telegram.replace(/^@/, '')}`"
                      target="_blank"
                      class="hover:text-brand-600 dark:hover:text-brand-400 hover:underline"
                    >{{ (candidate as any).telegram }}</a>
                  </dd>
                </div>
                <div v-if="(candidate as any).github">
                  <dt class="text-surface-400 inline-flex items-center gap-1">
                    <Github class="size-3.5" />GitHub
                  </dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium truncate">
                    <a
                      :href="(candidate as any).github.startsWith('http') ? (candidate as any).github : `https://github.com/${(candidate as any).github.replace(/^@/, '')}`"
                      target="_blank"
                      class="hover:text-brand-600 dark:hover:text-brand-400 hover:underline"
                    >{{ (candidate as any).github }}</a>
                  </dd>
                </div>
                <div>
                  <dt class="text-surface-400 inline-flex items-center gap-1">
                    <Calendar class="size-3.5" />Добавлен
                  </dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium">
                    <TimelineDateLink :date="candidate.createdAt">{{ new Date(candidate.createdAt).toLocaleDateString() }}</TimelineDateLink>
                  </dd>
                </div>
                <div>
                  <dt class="text-surface-400 inline-flex items-center gap-1">
                    <Clock class="size-3.5" />Обновлён
                  </dt>
                  <dd class="text-surface-700 dark:text-surface-200 font-medium">
                    <TimelineDateLink :date="candidate.updatedAt">{{ new Date(candidate.updatedAt).toLocaleDateString() }}</TimelineDateLink>
                  </dd>
                </div>
              </dl>
            </div>

            <!-- Единый блок резюме (тот же, что на полной странице): версии + promote + структурирование -->
            <CandidateResumePanel
              v-if="(candidate as any).hasResumeSnapshot || (candidate as any).hhResumeId"
              :candidate-id="candidateId"
              :candidate-name="`${candidate.lastName} ${candidate.firstName}`"
              :has-snapshot="Boolean((candidate as any).hasResumeSnapshot || (candidate as any).hhResumeId)"
              :resume-document-id="resumeDocumentId"
              :resume-document-mime="resumeDocumentMime"
              :resume-document-name="resumeDocumentName"
              :resume-document-preview-available="resumeDocumentPreviewAvailable"
              @changed="refresh()"
            />

            <!-- Properties -->
            <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4">
              <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-200 mb-2 px-2">{{ t('dashboard.candidateDrawer.properties') }}</h3>
              <PropertyBlock
                entity-type="candidate"
                :entity-id="candidateId"
                :entries="(candidate.properties ?? []) as import('~~/shared/properties').PropertyEntry[]"
                @refresh="refresh()"
              />
            </div>

            <!-- Tabs -->
            <DetailTabs
              v-model="activeTab"
              :tabs="[
                { key: 'applications', label: 'Отклики', count: candidate.applications?.length ?? 0 },
                { key: 'documents', label: 'Документы', count: candidate.documents?.length ?? 0 },
                { key: 'chat', label: 'Чат по отклику', hidden: !props.applicationId },
              ]"
            />

            <!-- Chat tab (Спринт 18) -->
            <div v-if="activeTab === 'chat' && props.applicationId">
              <CommsChatPanel :application-id="props.applicationId" />
            </div>

            <!-- Applications tab -->
            <div v-if="activeTab === 'applications'">
              <div class="flex justify-end mb-3">
                <button
                  class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                  @click="showApplyModal = true"
                >
                  <Plus class="size-3.5" />
                  {{ t('dashboard.candidateDrawer.applyToJob') }}
                </button>
              </div>

              <div
                v-if="!candidate.applications?.length"
                class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-8 text-center"
              >
                <Briefcase class="size-8 text-surface-300 dark:text-surface-600 mx-auto mb-2" />
                <p class="text-sm text-surface-500 dark:text-surface-400">{{ t('dashboard.candidateDrawer.noApplications') }}</p>
              </div>

              <div v-else class="space-y-2">
                <div
                  v-for="app in candidate.applications"
                  :key="app.id"
                  class="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-4 py-3 hover:border-surface-300 dark:hover:border-surface-700 hover:shadow-sm transition-all group gap-2"
                >
                  <NuxtLink
                    :to="localePath(`/dashboard/applications/${app.id}`)"
                    class="min-w-0 flex-1 block"
                  >
                    <h4 class="text-sm font-semibold text-surface-900 dark:text-surface-100 group-hover:text-brand-600 transition-colors truncate">
                      {{ app.job.title }}
                    </h4>
                    <span class="text-xs text-surface-400">
                      {{ t('dashboard.candidateDrawer.appliedLabel') }} <TimelineDateLink :date="app.createdAt">{{ new Date(app.createdAt).toLocaleDateString() }}</TimelineDateLink>
                    </span>
                  </NuxtLink>
                  <div class="flex items-center gap-2 shrink-0 sm:ml-3">
                    <span
                      v-if="(app as any).resumeVersion"
                      class="rounded bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 text-[10px] font-medium text-surface-500 dark:text-surface-400"
                      :title="t('candidate.applications.resumeVersion')"
                    >v{{ (app as any).resumeVersion.versionNumber }}</span>
                    <button
                      class="inline-flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 px-2 py-1 text-xs font-medium text-surface-600 dark:text-surface-400 hover:border-brand-400 dark:hover:border-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30 hover:text-brand-700 dark:hover:text-brand-300 transition-all cursor-pointer"
                      :title="$t('dashboard.interviews.schedule')"
                      @click="openScheduleInterview(app)"
                    >
                      <Calendar class="size-3" />
                      {{ $t('dashboard.interviews.schedule') }}
                    </button>
                    <StatusBadge :status="app.status as any" size="xs" />
                  </div>
                </div>
              </div>
            </div>

            <!-- Documents tab -->
            <div v-if="activeTab === 'documents'">
              <!-- Inline PDF preview -->
              <template v-if="showPreview">
                <div class="flex items-center justify-between mb-3">
                  <button
                    class="inline-flex items-center gap-1.5 text-sm font-medium text-surface-600 dark:text-surface-300 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                    @click="closePreview"
                  >
                    ← {{ $t('dashboard.common.back') }}
                  </button>
                  <div class="flex items-center gap-1">
                    <button
                      v-if="previewDocId"
                      class="rounded-lg p-1.5 text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                      :title="t('dashboard.candidateDrawer.download')"
                      @click="handleDownload(previewDocId!)"
                    >
                      <Download class="size-4" />
                    </button>
                  </div>
                </div>

                <div v-if="previewFilename" class="flex items-center gap-2 mb-3">
                  <FileText class="size-4 text-surface-400 shrink-0" />
                  <span class="text-sm font-medium text-surface-700 dark:text-surface-200 truncate">
                    {{ previewFilename }}
                  </span>
                </div>

                <iframe
                  v-if="previewUrl && isPdfPreview"
                  :src="previewUrl"
                  class="w-full rounded-lg border border-surface-200 dark:border-surface-800"
                  style="height: 60vh;"
                  :title="t('dashboard.candidateDrawer.documentPreviewTitle')"
                />
              </template>

              <!-- Parsed text preview -->
              <template v-else-if="showTextPreview">
                <div class="flex items-center justify-between mb-3">
                  <button
                    class="inline-flex items-center gap-1.5 text-sm font-medium text-surface-600 dark:text-surface-300 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                    @click="closeTextPreview"
                  >
                    ← {{ t('dashboard.common.back') }}
                  </button>
                </div>

                <div class="flex items-center gap-2 mb-3">
                  <FileText class="size-4 text-surface-400 shrink-0" />
                  <span class="text-sm font-medium text-surface-700 dark:text-surface-200 truncate">
                    {{ textPreviewFilename }}
                  </span>
                </div>

                <div v-if="isLoadingText" class="flex items-center justify-center py-12 text-surface-400">
                  <div class="size-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                </div>

                <div v-else class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 overflow-y-auto" style="max-height: 60vh;">
                  <template v-if="parsedSections.length">
                    <div v-for="(section, i) in parsedSections" :key="i" class="mb-4 last:mb-0">
                      <h4 class="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-1">{{ section.heading }}</h4>
                      <p class="text-sm text-surface-600 dark:text-surface-400 whitespace-pre-wrap">{{ section.content }}</p>
                    </div>
                  </template>
                  <p v-else-if="parsedText" class="text-sm text-surface-600 dark:text-surface-400 whitespace-pre-wrap">{{ parsedText }}</p>
                  <p v-else class="text-sm text-surface-400 text-center py-8">Текст не найден. Возможно, файл содержит изображения или повреждён.</p>
                </div>
              </template>

              <!-- Document list -->
              <template v-else>
                <div
                  v-if="!candidate.documents?.length"
                  class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-8 text-center"
                >
                  <FileText class="size-8 text-surface-300 dark:text-surface-600 mx-auto mb-2" />
                  <p class="text-sm text-surface-500 dark:text-surface-400">{{ t('dashboard.candidateDrawer.noDocuments') }}</p>
                </div>

                <div v-else class="space-y-2">
                  <div
                    v-for="doc in candidate.documents"
                    :key="doc.id"
                    class="group flex items-center justify-between rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-4 py-3 transition-colors"
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
                          · <TimelineDateLink :date="doc.createdAt">{{ new Date(doc.createdAt).toLocaleDateString() }}</TimelineDateLink>
                          <template v-if="doc.mimeType === 'application/pdf'"> · <span class="text-brand-500 dark:text-brand-400">{{ t('dashboard.candidateDrawer.clickToPreview') }}</span></template>
                        </span>
                      </div>
                    </div>
                    <div class="flex items-center gap-1 shrink-0" @click.stop>
                      <button
                        v-if="doc.parsed"
                        class="rounded-lg p-1.5 text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                        title="Показать распарсенный текст"
                        @click="handleShowText(doc.id)"
                      >
                        <FileText class="size-4" />
                      </button>
                      <button
                        v-if="doc.mimeType === 'application/pdf'"
                        class="rounded-lg p-1.5 text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                        :title="t('dashboard.candidateDrawer.previewPdf')"
                        @click="handlePreview(doc.id, doc.mimeType)"
                      >
                        <Eye class="size-4" />
                      </button>
                      <button
                        class="rounded-lg p-1.5 text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                        :title="t('dashboard.candidateDrawer.download')"
                        @click="handleDownload(doc.id)"
                      >
                        <Download class="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </template>
        </div>
      </aside>
    </Transition>

    <!-- Apply to Job Modal -->
    <ApplyToJobModal
      v-if="showApplyModal && candidate"
      :candidate-id="candidateId"
      @close="showApplyModal = false"
      @created="handleApplied"
    />

    <!-- Interview Schedule Sidebar -->
    <InterviewScheduleSidebar
      v-if="showInterviewSidebar && interviewTargetApp && candidate"
      :application-id="interviewTargetApp.id"
      :candidate-name="`${candidate.firstName} ${candidate.lastName}`"
      :job-title="interviewTargetApp.jobTitle"
      @close="showInterviewSidebar = false"
      @scheduled="showInterviewSidebar = false"
    />
  </Teleport>

  <Teleport to="body">
    <div v-if="drawerReferralOpen" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" @click.self="drawerReferralOpen = false">
      <div class="w-full max-w-md rounded-xl bg-white dark:bg-surface-900 p-5 shadow-xl">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-100">{{ t('candidate.detail.referralModal') }}</h3>
          <button type="button" class="rounded-lg p-1 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200" @click="drawerReferralOpen = false"><X class="size-4" /></button>
        </div>
        <ReferralButton :candidate-id="candidateId" />
      </div>
    </div>
  </Teleport>

  <!-- Фрод-флаг (из меню «Другое» drawer) -->
  <Teleport to="body">
    <div v-if="drawerFraudOpen" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" @click.self="drawerFraudOpen = false">
      <div class="w-full max-w-md rounded-xl bg-white dark:bg-surface-900 p-5 shadow-xl">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-100">{{ t('candidate.detail.fraudAction') }}</h3>
          <button type="button" class="rounded-lg p-1 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200" @click="drawerFraudOpen = false"><X class="size-4" /></button>
        </div>
        <select v-model="drawerFraudForm.reason" class="w-full mb-2 rounded-lg border border-surface-300 dark:border-surface-700 px-2 py-1.5 text-sm bg-white dark:bg-surface-900">
          <option value="blacklist">Чёрный список</option>
          <option value="security_incident">Инцидент безопасности</option>
          <option value="fake_data">Ложные данные</option>
          <option value="other_fraud">Иной фрод</option>
        </select>
        <textarea v-model="drawerFraudForm.notes" rows="2" placeholder="Заметки (необязательно)" class="w-full mb-3 rounded-lg border border-surface-300 dark:border-surface-700 px-2 py-1.5 text-sm bg-white dark:bg-surface-900" />
        <div class="flex justify-end gap-2">
          <button type="button" class="rounded-lg px-3 py-1.5 text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800" @click="drawerFraudOpen = false">Отмена</button>
          <button type="button" :disabled="drawerIsUpdatingFraud" class="rounded-lg bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50" @click="drawerSubmitFraud()">{{ drawerIsUpdatingFraud ? 'Сохранение…' : 'Пометить фрод' }}</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Слияние: редирект на полную страницу (где есть полноценный MergeCandidatesModal) -->
  <Teleport to="body">
    <div v-if="drawerMergeOpen" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" @click.self="drawerMergeOpen = false">
      <div class="w-full max-w-md rounded-xl bg-white dark:bg-surface-900 p-5 shadow-xl text-center">
        <GitMerge class="size-8 mx-auto text-surface-400 mb-3" />
        <p class="text-sm text-surface-600 dark:text-surface-300 mb-4">Слияние кандидатов доступно на полной странице карточки.</p>
        <div class="flex justify-center gap-2">
          <button type="button" class="rounded-lg px-3 py-1.5 text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800" @click="drawerMergeOpen = false">Отмена</button>
          <NuxtLink :to="localePath(`/dashboard/candidates/${candidateId}`)" class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700" @click="drawerMergeOpen = false">Открыть страницу</NuxtLink>
        </div>
      </div>
    </div>
  </Teleport>
</template>
