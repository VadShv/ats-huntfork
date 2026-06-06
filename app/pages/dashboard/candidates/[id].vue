<script setup lang="ts">
import { ArrowLeft, Pencil, Trash2, Mail, Phone, Calendar, Clock, Briefcase, FileText, Plus, Upload, Download, Eye, X, AlertTriangle, Venus, Mars } from 'lucide-vue-next'
import { z } from 'zod'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const candidateId = route.params.id as string
const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const toast = useToast()
const { t } = useI18n()

const { candidate, status: fetchStatus, error, refresh, updateCandidate, deleteCandidate } = useCandidate(candidateId)
const { formatCandidateName, formatDate } = useOrgSettings()

useSeoMeta({
  title: computed(() =>
    candidate.value
      ? `${candidate.value.firstName} ${candidate.value.lastName}`
      : 'Candidate',
  ),
})

// ─────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────

const activeTab = ref<'applications' | 'documents'>('applications')

// HH resume header info — подгружаем должность/город/опыт для шапки
interface HhResumeApiResp {
  resume?: {
    title?: string
    area?: string
    totalExperience?: { years?: number; monthsRemainder?: number }
  }
}
const { data: hhResumeData } = await useFetch<HhResumeApiResp | null>(
  () => `/api/candidates/${candidateId}/hh-resume`,
  { default: () => null, server: false, lazy: true },
)

function calcAge(birthDate?: string | null): number | null {
  if (!birthDate) return null
  const d = new Date(birthDate)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age > 0 && age < 120 ? age : null
}

const hhHeaderInfo = computed(() => {
  const r = hhResumeData.value?.resume
  const age = calcAge(candidate.value?.dateOfBirth)
  const exp = r?.totalExperience
  let totalExperience: string | undefined
  if (exp && typeof exp.years === 'number') {
    const parts: string[] = []
    if (exp.years > 0) parts.push(`${exp.years} ${ageWord(exp.years)}`)
    if (typeof exp.monthsRemainder === 'number' && exp.monthsRemainder > 0) {
      parts.push(`${exp.monthsRemainder} мес`)
    }
    totalExperience = parts.join(' ') || undefined
  }
  const title = r?.title
  const area = r?.area
  if (!title && !area && !age && !totalExperience) return null
  return { title, area, age, totalExperience }
})

function ageWord(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'год'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'года'
  return 'лет'
}

// ─────────────────────────────────────────────
// Edit mode
// ─────────────────────────────────────────────

const isEditing = ref(false)
const editForm = ref({
  firstName: '',
  lastName: '',
  displayName: '',
  email: '',
  phone: '',
  gender: '' as '' | 'male' | 'female' | 'other' | 'prefer_not_to_say',
  dateOfBirth: '',
})

function startEdit() {
  if (!candidate.value) return
  editForm.value = {
    firstName: candidate.value.firstName,
    lastName: candidate.value.lastName,
    displayName: candidate.value.displayName ?? '',
    email: candidate.value.email,
    phone: candidate.value.phone ?? '',
    gender: (candidate.value.gender as '' | 'male' | 'female' | 'other' | 'prefer_not_to_say') ?? '',
    dateOfBirth: candidate.value.dateOfBirth ?? '',
  }
  isEditing.value = true
}

function cancelEdit() {
  isEditing.value = false
  editErrors.value = {}
}

const editSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  displayName: z.string().max(200).optional(),
  email: z.string().min(1, 'Email is required').email('Invalid email address').max(255),
  phone: z.string().max(50).optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .refine((v) => {
      const d = new Date(v)
      return !isNaN(d.getTime()) && d.getFullYear() >= 1900 && d <= new Date()
    }, 'Must be a valid past date')
    .optional(),
})

const isSaving = ref(false)
const editErrors = ref<Record<string, string>>({})

async function handleSave() {
  const result = editSchema.safeParse({
    ...editForm.value,
    gender: editForm.value.gender || undefined,
    dateOfBirth: editForm.value.dateOfBirth || undefined,
    displayName: editForm.value.displayName || undefined,
  })
  if (!result.success) {
    editErrors.value = {}
    for (const issue of result.error.issues) {
      const field = issue.path[0]?.toString()
      if (field) editErrors.value[field] = issue.message
    }
    return
  }
  editErrors.value = {}

  isSaving.value = true
  try {
    await updateCandidate({
      firstName: editForm.value.firstName,
      lastName: editForm.value.lastName,
      displayName: editForm.value.displayName || null,
      email: editForm.value.email,
      phone: editForm.value.phone || null,
      gender: (editForm.value.gender as 'male' | 'female' | 'other' | 'prefer_not_to_say') || null,
      dateOfBirth: editForm.value.dateOfBirth || null,
    })
    isEditing.value = false
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    const message = err.data?.statusMessage ?? 'Failed to save changes'
    if (err.statusCode === 409 || err.data?.statusCode === 409) {
      editErrors.value.email = message
    } else {
      toast.error(message, { message, statusCode: err.statusCode ?? err.data?.statusCode })
    }
  } finally {
    isSaving.value = false
  }
}

// ─────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────

const isDeleting = ref(false)
const showDeleteConfirm = ref(false)

async function handleDelete() {
  isDeleting.value = true
  try {
    await deleteCandidate()
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Failed to delete candidate', { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
    isDeleting.value = false
    showDeleteConfirm.value = false
  }
}

// ─────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────

const applicationStatusClasses: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  screening: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  interview: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  offer: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400',
  hired: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
  rejected: 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400',
}

const genderLabels: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
}

const documentTypeLabels = computed<Record<string, string>>(() => ({
  resume: t('candidate.documents.resume'),
  cover_letter: t('candidate.documents.cover_letter'),
  other: t('candidate.documents.other'),
}))

// ─────────────────────────────────────────────
// Apply to job modal
// ─────────────────────────────────────────────

const showApplyModal = ref(false)

function handleApplied() {
  showApplyModal.value = false
  refresh()
}

// ─────────────────────────────────────────────
// Interview scheduling
// ─────────────────────────────────────────────

const showInterviewSidebar = ref(false)
const interviewTargetApp = ref<{ id: string; jobTitle: string } | null>(null)

function openScheduleInterview(app: { id: string; job: { title: string } }) {
  interviewTargetApp.value = { id: app.id, jobTitle: app.job.title }
  showInterviewSidebar.value = true
}

// ─────────────────────────────────────────────
// Documents — upload, download, delete
// ─────────────────────────────────────────────

const { uploadDocument, downloadDocument, getPreviewUrl, deleteDocument } = useDocuments()

const fileInput = ref<HTMLInputElement | null>(null)
const selectedDocType = ref<'resume' | 'cover_letter' | 'other'>('resume')
const isUploading = ref(false)
const uploadError = ref<string | null>(null)
const showDocDeleteConfirm = ref<string | null>(null)
const isDeletingDoc = ref(false)

// Preview state
const showPreview = ref(false)
const previewUrl = ref<string | null>(null)
const previewFilename = ref('')
const previewMimeType = ref('')
const previewDocId = ref<string | null>(null)
const isLoadingPreview = ref(false)
const previewError = ref<string | null>(null)

/** Whether the current preview file is a PDF (renderable in iframe) */
const isPdfPreview = computed(() => previewMimeType.value === 'application/pdf')

async function handlePreview(docId: string, mimeType?: string) {
  // Only PDFs can be previewed inline — for DOC/DOCX, download directly
  if (mimeType && mimeType !== 'application/pdf') {
    await handleDownload(docId)
    return
  }

  previewError.value = null
  showPreview.value = true
  previewDocId.value = docId

  // Find the document name from the candidate data
  const doc = candidate.value?.documents?.find((d: any) => d.id === docId)
  previewFilename.value = doc?.originalFilename ?? 'Document'
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

function triggerFileSelect() {
  fileInput.value?.click()
}

async function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  uploadError.value = null
  isUploading.value = true

  try {
    await uploadDocument(candidateId, file, selectedDocType.value)
  } catch (err: any) {
    const msg = err.data?.statusMessage ?? err.statusMessage ?? t('candidate.documents.uploadFailed')
    uploadError.value = msg
  } finally {
    isUploading.value = false
    // Reset input so the same file can be re-selected
    input.value = ''
  }
}

async function handleDownload(docId: string) {
  try {
    await downloadDocument(docId)
  } catch {
    toast.error(t('candidate.documents.downloadFailed'))
  }
}

async function handleDeleteDoc(docId: string) {
  isDeletingDoc.value = true
  try {
    await deleteDocument(docId, candidateId)
    showDocDeleteConfirm.value = null
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error(t('candidate.documents.deleteFailed'), { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
  } finally {
    isDeletingDoc.value = false
  }
}

/** Format bytes into a human-readable string */
function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="mx-auto max-w-[1400px]">
    <!-- Back link -->
    <NuxtLink
      :to="$localePath('/dashboard/candidates')"
      class="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 mb-6 transition-colors"
    >
      <ArrowLeft class="size-4" />
      {{ t('candidate.detail.backToCandidates') }}
    </NuxtLink>

    <!-- Loading -->
    <div v-if="fetchStatus === 'pending'" class="text-center py-12 text-surface-400">
      {{ t('candidate.detail.loading') }}
    </div>

    <!-- Error / not found -->
    <div
      v-else-if="error"
      class="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700"
    >
      {{ error.statusCode === 404 ? t('candidate.detail.notFound') : t('candidate.detail.failedToLoad') }}
      <NuxtLink :to="$localePath('/dashboard/candidates')" class="underline ml-1">{{ t('candidate.detail.backToCandidates') }}</NuxtLink>
    </div>

    <!-- Candidate detail -->
    <template v-else-if="candidate">
      <!-- VIEW MODE — header (full-width) + 2-column layout «Хантфлоу»-стиль -->
      <div v-if="!isEditing" class="space-y-6">
        <!-- ╗╗╗ HEADER (full-width): идентификация кандидата ╗╗╗ -->
        <header class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
          <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div class="flex items-start gap-4 min-w-0 flex-1">
              <!-- Аватар -->
              <div class="shrink-0 size-16 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center text-xl font-semibold">
                {{ (candidate.firstName?.[0] ?? '') + (candidate.lastName?.[0] ?? '') }}
              </div>
              <div class="min-w-0 flex-1">
                <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50 mb-1 break-words">
                  {{ formatCandidateName(candidate) }}
                </h1>
                <!-- Должность + город + возраст (из hh-резюме, если есть) -->
                <div v-if="hhHeaderInfo" class="text-sm text-surface-600 dark:text-surface-300 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span v-if="hhHeaderInfo.title" class="font-medium">{{ hhHeaderInfo.title }}</span>
                  <span v-if="hhHeaderInfo.area" class="inline-flex items-center gap-1">
                    <span class="text-surface-400">·</span>{{ hhHeaderInfo.area }}
                  </span>
                  <span v-if="hhHeaderInfo.age" class="inline-flex items-center gap-1">
                    <span class="text-surface-400">·</span>{{ hhHeaderInfo.age }} {{ ageWord(hhHeaderInfo.age) }}
                  </span>
                  <span v-if="hhHeaderInfo.totalExperience" class="inline-flex items-center gap-1">
                    <span class="text-surface-400">·</span>опыт {{ hhHeaderInfo.totalExperience }}
                  </span>
                </div>
                <!-- Контакты -->
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-surface-500">
                  <a
                    :href="`mailto:${candidate.email}`"
                    target="_blank"
                    class="inline-flex items-center gap-1 hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
                  >
                    <Mail class="size-3.5" />
                    {{ candidate.email }}
                  </a>
                  <a
                    v-if="candidate.phone"
                    :href="`tel:${candidate.phone}`"
                    class="inline-flex items-center gap-1 hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
                  >
                    <Phone class="size-3.5" />
                    {{ candidate.phone }}
                  </a>
                  <span v-if="candidate.gender" class="inline-flex items-center gap-1">
                    <component :is="candidate.gender === 'female' ? Venus : Mars" class="size-3.5" />
                    {{ genderLabels[candidate.gender] ?? candidate.gender }}
                  </span>
                  <span v-if="candidate.dateOfBirth" class="inline-flex items-center gap-1">
                    <Calendar class="size-3.5" />
                    {{ formatDate(candidate.dateOfBirth) }}
                  </span>
                  <span class="inline-flex items-center gap-1 text-surface-400">
                    <Clock class="size-3.5" />
                    {{ t('candidate.detail.updated') }}: {{ new Date(candidate.updatedAt).toLocaleDateString() }}
                  </span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <button
                class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                @click="startEdit"
              >
                <Pencil class="size-3.5" />
                {{ t('candidate.detail.edit') }}
              </button>
              <button
                class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-danger-300 dark:border-danger-700 px-3 py-1.5 text-sm font-medium text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950 transition-colors"
                @click="showDeleteConfirm = true"
              >
                <Trash2 class="size-3.5" />
                {{ t('candidate.detail.delete') }}
              </button>
            </div>
          </div>
        </header>

        <!-- ╗╗╗ 2-column body: center (AI + резюме) + right (tabs + properties) ╗╗╗ -->
        <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6">
        <!-- ╗╗╗ CENTER COLUMN: AI summary + hh resume ╗╗╗ -->
        <main class="space-y-4 min-w-0">
          <CandidateAiSummaryCard
            :candidate-id="candidateId"
            :ai-summary="(candidate as any).aiSummary"
            :ai-summary-at="(candidate as any).aiSummaryAt"
            :can-generate="Boolean((candidate as any).hhResumeId)"
            @generated="refresh()"
          />
          <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
            <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200 mb-4 flex items-center justify-between">
              <span>Резюме с hh.ru</span>
            </h2>
            <CandidateHhResumeView
              :candidate-id="candidateId"
              :has-snapshot="Boolean((candidate as any).hhResumeId)"
              :candidate-name="`${candidate.lastName} ${candidate.firstName}`"
            />
          </div>
        </main>

        <!-- ╗╗╗ RIGHT COLUMN: tabs (applications, documents) ╗╗╗ -->
        <section class="space-y-4 min-w-0">
        <!-- Tabs -->
        <div class="border-b border-surface-200 dark:border-surface-800 mb-4">
          <div class="flex gap-1">
            <button
              class="cursor-pointer px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
              :class="activeTab === 'applications'
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300 dark:hover:text-surface-300'"
              @click="activeTab = 'applications'"
            >
              {{ t('candidate.applications.tab') }} ({{ candidate.applications?.length ?? 0 }})
            </button>
            <button
              class="cursor-pointer px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
              :class="activeTab === 'documents'
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300 dark:hover:text-surface-300'"
              @click="activeTab = 'documents'"
            >
              {{ t('candidate.documents.tab') }} ({{ candidate.documents?.length ?? 0 }})
            </button>
          </div>
        </div>

        <!-- Applications tab -->
        <div v-if="activeTab === 'applications'">
          <!-- Apply to Job button -->
          <div class="flex justify-end mb-3">
            <button
              class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              @click="showApplyModal = true"
            >
              <Plus class="size-3.5" />
              {{ t('candidate.applications.applyToJob') }}
            </button>
          </div>

          <div
            v-if="!candidate.applications?.length"
            class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-8 text-center"
          >
            <Briefcase class="size-8 text-surface-300 dark:text-surface-600 mx-auto mb-2" />
            <p class="text-sm text-surface-500 dark:text-surface-400">{{ t('candidate.applications.empty') }}</p>
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="app in candidate.applications"
              :key="app.id"
              class="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-4 py-3 hover:border-surface-300 dark:hover:border-surface-700 hover:shadow-sm transition-all group gap-2"
            >
              <NuxtLink
                :to="$localePath(`/dashboard/applications/${app.id}`)"
                class="min-w-0 flex-1 block"
              >
                <h4 class="text-sm font-semibold text-surface-900 dark:text-surface-100 group-hover:text-brand-600 transition-colors truncate">
                  {{ app.job.title }}
                </h4>
                <span class="text-xs text-surface-400">
                  {{ t('candidate.applications.applied') }} <TimelineDateLink :date="app.createdAt">{{ new Date(app.createdAt).toLocaleDateString() }}</TimelineDateLink>
                </span>
              </NuxtLink>
              <div class="flex items-center gap-2 shrink-0 sm:ml-3">
                <button
                  class="inline-flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 px-2 py-1 text-xs font-medium text-surface-600 dark:text-surface-400 hover:border-brand-400 dark:hover:border-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30 hover:text-brand-700 dark:hover:text-brand-300 transition-all cursor-pointer"
                  :title="t('candidate.applications.scheduleInterview')"
                  @click="openScheduleInterview(app)"
                >
                  <Calendar class="size-3" />
                  {{ t('candidate.applications.schedule') }}
                </button>
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0"
                  :class="applicationStatusClasses[app.status] ?? 'bg-surface-100 text-surface-600'"
                >
                  {{ app.status }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Apply to Job Modal -->
        <ApplyToJobModal
          v-if="showApplyModal"
          :candidate-id="candidateId"
          @close="showApplyModal = false"
          @created="handleApplied"
        />

        <!-- Interview Schedule Sidebar -->
        <InterviewScheduleSidebar
          v-if="showInterviewSidebar && interviewTargetApp"
          :application-id="interviewTargetApp.id"
          :candidate-name="`${candidate.firstName} ${candidate.lastName}`"
          :job-title="interviewTargetApp.jobTitle"
          @close="showInterviewSidebar = false"
          @scheduled="showInterviewSidebar = false"
        />

        <!-- Documents tab (в правой колонке) -->
        <div v-if="activeTab === 'documents'">
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
            <div class="flex items-center justify-between mb-3">
              <button
                class="inline-flex items-center gap-1.5 text-sm font-medium text-surface-600 dark:text-surface-300 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                @click="closePreview"
              >
                <ArrowLeft class="size-3.5" />
                {{ t('candidate.documents.backToDocuments') }}
              </button>
              <div class="flex items-center gap-1">
                <button
                  v-if="previewDocId"
                  class="rounded-lg p-1.5 text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                  :title="t('candidate.documents.download')"
                  @click="handleDownload(previewDocId!)"
                >
                  <Download class="size-4" />
                </button>
              </div>
            </div>

            <!-- Filename -->
            <div v-if="previewFilename" class="flex items-center gap-2 mb-3">
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
                {{ t('candidate.documents.goBack') }}
              </button>
            </div>

            <!-- PDF iframe — same-origin, server streams the bytes -->
            <iframe
              v-else-if="previewUrl && isPdfPreview"
              :src="previewUrl"
              class="w-full rounded-lg border border-surface-200 dark:border-surface-800"
              style="height: 70vh;"
              :title="t('candidate.documents.previewTitle')"
            />
          </template>

          <!-- ── Document list (normal state) ── -->
          <template v-else>
            <!-- Upload controls -->
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <select
                  v-model="selectedDocType"
                  class="rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-sm text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="resume">{{ t('candidate.documents.resume') }}</option>
                  <option value="cover_letter">{{ t('candidate.documents.cover_letter') }}</option>
                  <option value="other">{{ t('candidate.documents.other') }}</option>
                </select>
              </div>
              <button
                :disabled="isUploading"
                class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                @click="triggerFileSelect"
              >
                <Upload class="size-3.5" />
                {{ isUploading ? t('candidate.documents.uploading') : t('candidate.documents.uploadButton') }}
              </button>
            </div>

            <!-- Upload error -->
            <div
              v-if="uploadError"
              class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400 mb-3"
            >
              {{ uploadError }}
              <button class="underline ml-1" @click="uploadError = null">{{ t('candidate.documents.dismiss') }}</button>
            </div>

            <!-- Empty state -->
            <div
              v-if="!candidate.documents?.length"
              class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-8 text-center"
            >
              <FileText class="size-8 text-surface-300 dark:text-surface-600 mx-auto mb-2" />
              <p class="text-sm text-surface-500 dark:text-surface-400">{{ t('candidate.documents.empty') }}</p>
              <p class="text-xs text-surface-400 mt-1">
                {{ t('candidate.documents.emptyHint') }}
              </p>
            </div>

            <!-- Document list -->
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
                      <template v-if="doc.mimeType === 'application/pdf'"> · <span class="text-brand-500 dark:text-brand-400">{{ t('candidate.documents.clickToPreview') }}</span></template>
                    </span>
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0" @click.stop>
                  <button
                    v-if="doc.mimeType === 'application/pdf'"
                    class="rounded-lg p-1.5 text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                    :title="t('candidate.documents.preview')"
                    @click="handlePreview(doc.id, doc.mimeType)"
                  >
                    <Eye class="size-4" />
                  </button>
                  <button
                    class="rounded-lg p-1.5 text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                    :title="t('candidate.documents.download')"
                    @click="handleDownload(doc.id)"
                  >
                    <Download class="size-4" />
                  </button>
                  <button
                    class="rounded-lg p-1.5 text-surface-400 hover:text-danger-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                    :title="t('candidate.documents.delete')"
                    @click="showDocDeleteConfirm = doc.id"
                  >
                    <Trash2 class="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </template>

          <!-- Document delete confirmation dialog -->
          <Teleport to="body">
            <div v-if="showDocDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center">
              <div class="absolute inset-0 bg-black/50" @click="showDocDeleteConfirm = null" />
              <div class="relative bg-white dark:bg-surface-900 rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
                <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-2">{{ t('candidate.documents.deleteConfirmTitle') }}</h3>
                <p class="text-sm text-surface-600 dark:text-surface-400 mb-4">
                  {{ t('candidate.documents.deleteConfirmBody') }}
                </p>
                <div class="flex justify-end gap-2">
                  <button
                    :disabled="isDeletingDoc"
                    class="rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                    @click="showDocDeleteConfirm = null"
                  >
                    {{ t('dashboard.common.cancel') }}
                  </button>
                  <button
                    :disabled="isDeletingDoc"
                    class="rounded-lg bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50 transition-colors"
                    @click="handleDeleteDoc(showDocDeleteConfirm!)"
                  >
                    {{ isDeletingDoc ? t('candidate.documents.deleting') : t('candidate.documents.delete') }}
                  </button>
                </div>
              </div>
            </div>
          </Teleport>
        </div>

        <!-- Custom properties (Notion-style) -->
        <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 mt-4">
          <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200 mb-2 px-2">{{ t('candidate.detail.properties') }}</h2>
          <PropertyBlock
            entity-type="candidate"
            :entity-id="candidateId"
            :entries="(candidate.properties ?? []) as import('~~/shared/properties').PropertyEntry[]"
            @refresh="refresh()"
          />
        </div>
        </section>
        </div>
      </div>

      <!-- EDIT MODE -->
      <div v-else>
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50 mb-6">{{ t('candidate.detail.editTitle') }}</h1>

        <form class="space-y-5" @submit.prevent="handleSave">
          <!-- First Name -->
          <div>
            <label for="edit-firstName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ t('candidate.detail.firstName') }} <span class="text-danger-500">*</span>
            </label>
            <input
              id="edit-firstName"
              v-model="editForm.firstName"
              type="text"
              class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              :class="editErrors.firstName ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
            />
            <p v-if="editErrors.firstName" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ editErrors.firstName }}</p>
          </div>

          <!-- Last Name -->
          <div>
            <label for="edit-lastName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ t('candidate.detail.lastName') }} <span class="text-danger-500">*</span>
            </label>
            <input
              id="edit-lastName"
              v-model="editForm.lastName"
              type="text"
              class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              :class="editErrors.lastName ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
            />
            <p v-if="editErrors.lastName" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ editErrors.lastName }}</p>
          </div>

          <!-- Email -->
          <div>
            <label for="edit-email" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ t('candidate.detail.email') }} <span class="text-danger-500">*</span>
            </label>
            <input
              id="edit-email"
              v-model="editForm.email"
              type="email"
              class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              :class="editErrors.email ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
            />
            <p v-if="editErrors.email" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ editErrors.email }}</p>
          </div>

          <!-- Phone -->
          <div>
            <label for="edit-phone" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ t('candidate.detail.phone') }}
            </label>
            <input
              id="edit-phone"
              v-model="editForm.phone"
              type="tel"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            />
          </div>

          <!-- Display Name -->
          <div>
            <label for="edit-displayName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ t('candidate.detail.displayName') }}
              <span class="ml-1 text-xs font-normal text-surface-400">{{ t('candidate.detail.displayNameHint') }}</span>
            </label>
            <input
              id="edit-displayName"
              v-model="editForm.displayName"
              type="text"
              placeholder="e.g. Nguyễn Văn A"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            />
          </div>

          <!-- Gender + Date of Birth -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label for="edit-gender" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ t('candidate.detail.gender') }}
              </label>
              <select
                id="edit-gender"
                v-model="editForm.gender"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              >
                <option value="">{{ $t('dashboard.common.none') }}</option>
                <option value="male">{{ $t('dashboard.candidates.gender.male') }}</option>
                <option value="female">{{ $t('dashboard.candidates.gender.female') }}</option>
                <option value="other">{{ $t('dashboard.candidates.gender.other') }}</option>
                <option value="prefer_not_to_say">{{ $t('dashboard.candidates.gender.prefer_not_to_say') }}</option>
              </select>
            </div>
            <div>
              <label for="edit-dateOfBirth" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ t('candidate.detail.dateOfBirth') }}
              </label>
              <input
                id="edit-dateOfBirth"
                v-model="editForm.dateOfBirth"
                type="date"
                :max="new Date().toISOString().split('T')[0]"
                class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                :class="editErrors.dateOfBirth ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
              />
              <p v-if="editErrors.dateOfBirth" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ editErrors.dateOfBirth }}</p>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-3 pt-2">
            <button
              type="submit"
              :disabled="isSaving"
              class="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {{ isSaving ? t('candidate.detail.saving') : t('candidate.detail.saveChanges') }}
            </button>
            <button
              type="button"
              class="rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              @click="cancelEdit"
            >
              {{ t('candidate.detail.cancel') }}
            </button>
          </div>
        </form>
      </div>

      <!-- Delete confirmation dialog -->
      <Teleport to="body">
        <div v-if="showDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="absolute inset-0 bg-black/50" @click="showDeleteConfirm = false" />
          <div class="relative bg-white dark:bg-surface-900 rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-2">{{ t('candidate.detail.deleteTitle') }}</h3>
            <p class="text-sm text-surface-600 dark:text-surface-400 mb-4">
              {{ t('candidate.detail.deleteBody') }} <strong>{{ formatCandidateName(candidate) }}</strong>
            </p>
            <div class="flex justify-end gap-2">
              <button
                :disabled="isDeleting"
                class="rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                @click="showDeleteConfirm = false"
              >
                {{ t('candidate.detail.cancel') }}
              </button>
              <button
                :disabled="isDeleting"
                class="rounded-lg bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50 transition-colors"
                @click="handleDelete"
              >
                {{ isDeleting ? t('candidate.detail.deleting') : t('candidate.detail.delete') }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>
