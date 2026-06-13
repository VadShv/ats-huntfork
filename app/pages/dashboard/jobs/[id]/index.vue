<script setup lang="ts">
import {
  ArrowLeft, ArrowRight, Briefcase, Calendar, Clock, Hash, UserRound, Mail, MessageSquare,
  FileText, Paperclip, Download, Eye, Phone, Search, ExternalLink,
  Pencil, Trash2, Globe, ChevronDown, X,
  Video, Building2, Code2, UsersRound, Save, Check, MapPin, Users, Plus,
  CheckCircle2, XCircle, AlertTriangle, ArrowUpDown, ListFilter,
  Maximize2, Minimize2, Brain, Loader2, History, SlidersHorizontal,
  Inbox, Snowflake, UserPlus,
} from 'lucide-vue-next'
import { useLocalStorageState } from '~/composables/useLocalStorageState'
import type { PropertyEntry, PropertyFilter } from '~~/shared/properties'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'
import { getApplicationSourceMeta, type ApplicationSource } from '~/composables/useApplicationSource'
import ApplicationCommentThread from '~/components/Comments/ApplicationCommentThread.vue'

const { t, te } = useI18n()
import { APPLICATION_STATUS_TRANSITIONS, INTERVIEW_STATUS_TRANSITIONS } from '~~/shared/status-transitions'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const localePath = useLocalePath()
const jobId = route.params.id as string
const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const { track } = useTrack()
const toast = useToast()
const { formatPersonName } = useOrgSettings()

// ─────────────────────────────────────────────
// Job data (with update/delete support)
// ─────────────────────────────────────────────

const { job: jobData, status: jobFetchStatus, error: jobError } = useJob(jobId)

// ─────────────────────────────────────────────
// Applications data — автодогрузка всех откликов батчами по 1000.
// Даже если откликов 5000+, UI получит все без ручной пагинации.
// ─────────────────────────────────────────────

const PIPELINE_STATUSES = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const
type PipelineStatus = typeof PIPELINE_STATUSES[number]

const PAGE_SIZE = 1000
interface AppRow {
  id: string
  jobId: string
  candidateId: string
  status: string
  score?: number | null
  currentStageId?: string | null
  createdAt: string
  [k: string]: unknown
}
interface AppPage {
  data: AppRow[]
  total: number
  page: number
  limit: number
}
const applications = ref<AppRow[]>([])
const total = ref(0)
const appFetchStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const appError = ref<unknown>(null)
const isLoadingMore = ref(false)

// Инкремент при каждом новом loadApplications — сталые ответы не пишут в стейт.
let appsRequestId = 0

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function fetchAppsPage(query: Record<string, unknown>, maxRetries = 4): Promise<AppPage> {
  let attempt = 0
  while (true) {
    try {
      return await $fetch<AppPage>('/api/applications', { query, credentials: 'include' })
    }
    catch (err: any) {
      const status = err?.response?.status ?? err?.statusCode
      const retriable = status === 429 || status === 502 || status === 503 || status === 504
      if (!retriable || attempt >= maxRetries) throw err
      const backoff = 400 * 2 ** attempt + Math.random() * 200
      await sleep(backoff)
      attempt += 1
    }
  }
}

async function loadApplications() {
  const myId = ++appsRequestId
  appFetchStatus.value = 'pending'
  appError.value = null
  try {
    const baseQuery: Record<string, unknown> = { jobId, limit: PAGE_SIZE, page: 1 }
    const first = await fetchAppsPage(baseQuery)
    if (myId !== appsRequestId) return
    applications.value = first.data
    total.value = first.total
    appFetchStatus.value = 'success'

    if (first.total > applications.value.length) {
      isLoadingMore.value = true
      let page = 2
      while (applications.value.length < first.total && page <= 20) {
        const next = await fetchAppsPage({ ...baseQuery, page })
        if (myId !== appsRequestId) return
        if (!next.data.length) break
        applications.value = [...applications.value, ...next.data]
        page += 1
      }
      isLoadingMore.value = false
    }
  }
  catch (err: any) {
    if (myId !== appsRequestId) return
    if (err?.name === 'AbortError') return
    appError.value = err
    appFetchStatus.value = 'error'
    isLoadingMore.value = false
  }
}

async function refreshApps() {
  await loadApplications()
}

onMounted(() => { loadApplications() })

// Read initial pipeline stage from URL query param (?stage=screening)
const initialStage = PIPELINE_STATUSES.includes(route.query.stage as any)
  ? (route.query.stage as PipelineStatus)
  : 'new'
const focusStatus = ref<PipelineStatus>(initialStage)

const focusedApplications = computed(() =>
  applications.value.filter((application) => application.status === focusStatus.value),
)

// Search within the focused list
const searchTerm = ref('')

// ─────────────────────────────────────────────
// Filters & Sorting
// ─────────────────────────────────────────────

type SortOption = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'score-desc' | 'score-asc' | 'updated-desc'
type ScoreFilter = 'all' | 'high' | 'medium' | 'low' | 'none'
type InterviewFilter = 'all' | 'has-interview' | 'no-interview'

const sortBy = ref<SortOption>('score-desc')
const scoreFilter = ref<ScoreFilter>('all')
const interviewFilter = ref<InterviewFilter>('all')
const propertyFilters = ref<PropertyFilter[]>([])
const showSortPanel = ref(false)
const showFilterPanel = ref(false)
// Sprint 3: тумблер «Скрыть холодных (hh_sourcing)» — по умолчанию OFF, сохраняем в localStorage.
const hideColdSourcing = useLocalStorageState<boolean>('kanban-hide-cold', false)

const hasActiveFilters = computed(() =>
  scoreFilter.value !== 'all'
  || interviewFilter.value !== 'all'
  || propertyFilters.value.length > 0
  || hideColdSourcing.value,
)
const activeFilterCount = computed(() => {
  let count = 0
  if (scoreFilter.value !== 'all') count++
  if (interviewFilter.value !== 'all') count++
  if (hideColdSourcing.value) count++
  count += propertyFilters.value.length
  return count
})

function clearFilters() {
  scoreFilter.value = 'all'
  interviewFilter.value = 'all'
  propertyFilters.value = []
}

const sortOptions = computed<{ value: SortOption; label: string }[]>(() => [
  { value: 'date-desc', label: t('dashboard.jobs.detail.sortNewest') },
  { value: 'date-asc', label: t('dashboard.jobs.detail.sortOldest') },
  { value: 'name-asc', label: t('dashboard.jobs.detail.sortNameAZ') },
  { value: 'name-desc', label: t('dashboard.jobs.detail.sortNameZA') },
  { value: 'score-desc', label: t('dashboard.jobs.detail.sortScoreHigh') },
  { value: 'score-asc', label: t('dashboard.jobs.detail.sortScoreLow') },
  { value: 'updated-desc', label: t('dashboard.jobs.detail.sortUpdated') },
])

const currentSortLabel = computed(() =>
  sortOptions.value.find(o => o.value === sortBy.value)?.label ?? t('dashboard.jobs.detail.sort'),
)

const scoreFilterOptions = computed<{ value: ScoreFilter; label: string }[]>(() => [
  { value: 'all', label: t('dashboard.jobs.detail.filterAll') },
  { value: 'high', label: '75+' },
  { value: 'medium', label: '40–74' },
  { value: 'low', label: '< 40' },
  { value: 'none', label: t('dashboard.jobs.detail.filterNoScore') },
])

const interviewFilterOptions = computed<{ value: InterviewFilter; label: string }[]>(() => [
  { value: 'all', label: t('dashboard.jobs.detail.filterAll') },
  { value: 'has-interview', label: t('dashboard.jobs.detail.filterScheduled') },
  { value: 'no-interview', label: t('dashboard.jobs.detail.filterNone') },
])

function selectSort(option: SortOption) {
  sortBy.value = option
  showSortPanel.value = false
}

function closePanels() {
  showSortPanel.value = false
  showFilterPanel.value = false
  showOverviewDropdown.value = false
}

const filteredApplications = computed(() => {
  let result = focusedApplications.value

  // Text search
  if (searchTerm.value.trim()) {
    const term = searchTerm.value.toLowerCase()
    result = result.filter((app) => {
      const name = `${app.candidateFirstName} ${app.candidateLastName}`.toLowerCase()
      const email = (app.candidateEmail ?? '').toLowerCase()
      return name.includes(term) || email.includes(term)
    })
  }

  // Score filter
  if (scoreFilter.value !== 'all') {
    result = result.filter((app) => {
      switch (scoreFilter.value) {
        case 'high': return app.score != null && app.score >= 75
        case 'medium': return app.score != null && app.score >= 40 && app.score < 75
        case 'low': return app.score != null && app.score < 40
        case 'none': return app.score == null
        default: return true
      }
    })
  }

  // Interview filter
  if (interviewFilter.value !== 'all') {
    result = result.filter((app) => {
      const hasInterview = applicationsWithInterviews.value.has(app.id)
      return interviewFilter.value === 'has-interview' ? hasInterview : !hasInterview
    })
  }

  // Sprint 3: «Скрыть холодных» — прячем application'ы с source='hh_sourcing'.
  if (hideColdSourcing.value) {
    result = result.filter((app) => (app as any).source !== 'hh_sourcing')
  }

  // Property filters
  if (propertyFilters.value.length > 0) {
    result = result.filter((app) => {
      const props = (app as any).properties as PropertyEntry[] | undefined ?? []
      return propertyFilters.value.every((pf) => {
        const entry = props.find((e) => e.definition.id === pf.propertyDefinitionId)
        const val = entry?.value ?? null
        switch (pf.op) {
          case 'isEmpty': return val === null || val === '' || (Array.isArray(val) && val.length === 0)
          case 'isNotEmpty': return val !== null && val !== '' && !(Array.isArray(val) && val.length === 0)
          case 'equals': return String(val ?? '') === String(pf.value ?? '')
          case 'contains': return String(val ?? '').toLowerCase().includes(String(pf.value ?? '').toLowerCase())
          case 'in': return Array.isArray(pf.value) && Array.isArray(val)
            ? (pf.value as string[]).some((v) => (val as string[]).includes(v))
            : Array.isArray(pf.value) && (pf.value as string[]).includes(String(val ?? ''))
          default: return true
        }
      })
    })
  }
  return [...result].sort((a, b) => {
    switch (sortBy.value) {
      case 'date-desc':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      case 'date-asc':
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      case 'name-asc': {
        const nameA = `${a.candidateFirstName} ${a.candidateLastName}`.toLowerCase()
        const nameB = `${b.candidateFirstName} ${b.candidateLastName}`.toLowerCase()
        return nameA.localeCompare(nameB)
      }
      case 'name-desc': {
        const nameA = `${a.candidateFirstName} ${a.candidateLastName}`.toLowerCase()
        const nameB = `${b.candidateFirstName} ${b.candidateLastName}`.toLowerCase()
        return nameB.localeCompare(nameA)
      }
      case 'score-desc':
        return (b.score ?? -1) - (a.score ?? -1)
      case 'score-asc':
        return (a.score ?? -1) - (b.score ?? -1)
      case 'updated-desc':
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      default:
        return 0
    }
  })
})

type StatusCountMap = {
  new: number
  screening: number
  interview: number
  offer: number
  hired: number
  rejected: number
}

const statusCounts = computed(() => {
  const counts: StatusCountMap = { new: 0, screening: 0, interview: 0, offer: 0, hired: 0, rejected: 0 }
  for (const application of applications.value) {
    if (application.status in counts) {
      counts[application.status as PipelineStatus] += 1
    }
  }
  return counts
})

// Sprint 3: разбивка по источнику — все/отклики/холодные/ручные.
const sourceCounts = computed(() => {
  const c = { total: 0, hh: 0, cold: 0, manual: 0, api: 0, other: 0 }
  for (const a of applications.value) {
    c.total += 1
    const s = (a as any).source as ApplicationSource
    if (s === 'hh') c.hh += 1
    else if (s === 'hh_sourcing') c.cold += 1
    else if (s === 'manual') c.manual += 1
    else if (s === 'api') c.api += 1
    else c.other += 1
  }
  return c
})

const currentIndex = ref(0)

// Mobile: toggle between candidate list and detail view
const showMobileDetail = ref(false)

watch(focusedApplications, () => {
  if (focusedApplications.value.length === 0) {
    currentIndex.value = 0
    return
  }
  if (currentIndex.value >= focusedApplications.value.length) {
    currentIndex.value = focusedApplications.value.length - 1
  }
}, { immediate: true })

// Also clamp when property/score/interview filters change and shrink filteredApplications
watch(filteredApplications, (apps) => {
  if (apps.length === 0) {
    currentIndex.value = 0
    return
  }
  if (currentIndex.value >= apps.length) {
    currentIndex.value = apps.length - 1
  }
})

watch(focusStatus, () => {
  currentIndex.value = 0
  searchTerm.value = ''
  propertyFilters.value = []
  closePanels()
})

// Auto-scroll mobile bottom bar to keep selected candidate visible
watch(currentIndex, () => {
  nextTick(() => {
    const container = mobileBottomBar.value
    if (!container) return
    const selected = container.querySelector(`[data-candidate-idx="${currentIndex.value}"]`) as HTMLElement | null
    selected?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  })
})

const currentSummary = computed(() => filteredApplications.value[currentIndex.value] ?? null)

// Detail tab for center panel
type DetailTab = 'overview' | 'interviews' | 'documents' | 'responses' | 'ai-analysis' | 'timeline' | 'properties'
const detailTab = ref<DetailTab>('overview')

// Overview section visibility toggles
const overviewSections = reactive({
  aiAnalysis: true,
  interviews: true,
  documents: true,
  responses: true,
  properties: true,
})
const showOverviewDropdown = ref(false)
const overviewDropdownRef = ref<HTMLElement | null>(null)

function handleOverviewDropdownClickOutside(event: MouseEvent) {
  if (overviewDropdownRef.value && !overviewDropdownRef.value.contains(event.target as Node)) {
    showOverviewDropdown.value = false
  }
}

watch(showOverviewDropdown, (val) => {
  if (val) {
    setTimeout(() => document.addEventListener('click', handleOverviewDropdownClickOutside), 0)
  } else {
    document.removeEventListener('click', handleOverviewDropdownClickOutside)
  }
})

// Which sections to display based on active tab
const showSection = computed(() => ({
  profile: detailTab.value === 'overview',
  aiAnalysis: detailTab.value === 'overview' ? overviewSections.aiAnalysis : detailTab.value === 'ai-analysis',
  interviews: detailTab.value === 'overview' ? overviewSections.interviews : detailTab.value === 'interviews',
  documents: detailTab.value === 'overview' ? overviewSections.documents : detailTab.value === 'documents',
  responses: detailTab.value === 'overview' ? overviewSections.responses : detailTab.value === 'responses',
  properties: detailTab.value === 'overview' ? overviewSections.properties : detailTab.value === 'properties',
  timeline: detailTab.value === 'timeline',
}))

// ─────────────────────────────────────────────
// Timeline
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

const timelineActionLabels = computed<Record<string, string>>(() => ({
  created: t('dashboard.jobs.detail.tlCreated'),
  updated: t('dashboard.jobs.detail.tlUpdated'),
  deleted: t('dashboard.jobs.detail.tlDeleted'),
  status_changed: t('dashboard.jobs.detail.tlStatusChanged'),
  comment_added: t('dashboard.jobs.detail.tlCommentAdded'),
  scored: t('dashboard.jobs.detail.tlScored'),
  scheduled: t('dashboard.jobs.detail.tlScheduled'),
}))

function formatTimelineDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface TimelineActionStyle {
  icon: typeof Plus
  color: string
  bg: string
}

function getTimelineActionStyle(action: string): TimelineActionStyle {
  const map: Record<string, TimelineActionStyle> = {
    created: { icon: Plus, color: 'text-success-600 dark:text-success-400', bg: 'bg-success-50 dark:bg-success-950/50' },
    updated: { icon: Pencil, color: 'text-brand-600 dark:text-brand-400', bg: 'bg-brand-50 dark:bg-brand-950/50' },
    deleted: { icon: Trash2, color: 'text-danger-600 dark:text-danger-400', bg: 'bg-danger-50 dark:bg-danger-950/50' },
    status_changed: { icon: ArrowRight, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/50' },
    comment_added: { icon: MessageSquare, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/50' },
    scored: { icon: Brain, color: 'text-accent-600 dark:text-accent-400', bg: 'bg-accent-50 dark:bg-accent-950/50' },
    scheduled: { icon: Calendar, color: 'text-brand-600 dark:text-brand-400', bg: 'bg-brand-50 dark:bg-brand-950/50' },
  }
  return map[action] ?? { icon: Clock, color: 'text-surface-500 dark:text-surface-400', bg: 'bg-surface-100 dark:bg-surface-800' }
}

function getTimelineStatusBadge(status: string): string {
  const s = status.toLowerCase()
  const map: Record<string, string> = {
    new: 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300',
    screening: 'bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300',
    interview: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300',
    offer: 'bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-300',
    hired: 'bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300',
    rejected: 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-300',
  }
  return map[s] ?? 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300'
}

function describeTimelineItem(item: TimelineEntry): string {
  const actor = item.actorName ?? item.actorEmail ?? 'System'
  const action = timelineActionLabels[item.action] ?? item.action
  const resource = item.resourceType

  if (item.action === 'status_changed' && item.metadata) {
    const from = item.metadata.from_status ?? item.metadata.fromStatus
    const to = item.metadata.to_status ?? item.metadata.toStatus
    if (from && to) return `${actor} changed ${resource} status from ${from} to ${to}`
  }

  if (item.action === 'scored' && item.metadata) {
    const score = item.metadata.score
    if (score != null) return `${actor} scored ${resource} — ${score} pts`
  }

  return `${actor} ${action.toLowerCase()} ${resource}`
}

// Section refs
const overviewRef = ref<HTMLElement | null>(null)
const interviewsRef = ref<HTMLElement | null>(null)
const documentsRef = ref<HTMLElement | null>(null)
const responsesRef = ref<HTMLElement | null>(null)
const detailScrollContainer = ref<HTMLElement | null>(null)
const mobileBottomBar = ref<HTMLElement | null>(null)

type SwipeDocument = {
  id: string
  type: 'resume' | 'cover_letter' | 'other'
  originalFilename: string
  mimeType: string
  createdAt: string | Date
}

type SwipeResponse = {
  id: string
  value: unknown
  question: {
    id: string
    label: string
    type: string
    options: string[] | null
  } | null
}

type SwipeApplicationDetail = {
  id: string
  status: string
  score: number | null
  notes: string | null
  createdAt: string | Date
  updatedAt: string | Date
  candidate: {
    id: string
    firstName: string
    lastName: string
    email: string
    phone: string | null
    documents: SwipeDocument[]
  }
  responses: SwipeResponse[]
  properties: PropertyEntry[]
}

const currentApplicationId = ref('')

watch(currentSummary, (summary) => {
  if (!summary?.id) return
  currentApplicationId.value = summary.id
}, { immediate: true })

const {
  data: currentApplication,
  status: detailFetchStatus,
  execute: executeDetailFetch,
} = useFetch<SwipeApplicationDetail | null>(
  () => `/api/applications/${currentApplicationId.value}`,
  {
    key: computed(() => `pipeline-application-${currentApplicationId.value}`),
    immediate: false,
    watch: false,
    headers: useRequestHeaders(['cookie']),
  },
)

// Cache the last successfully loaded detail so switching candidates doesn't flash a loading spinner
const cachedApplication = ref<SwipeApplicationDetail | null>(null)

const resolvedCurrentApplication = computed(() => {
  if (currentApplication.value && currentApplication.value.id === currentApplicationId.value) {
    return currentApplication.value
  }
  // Show cached (previous) data while the new detail is loading
  return cachedApplication.value
})

watch(currentApplication, (val) => {
  if (val && val.id === currentApplicationId.value) {
    cachedApplication.value = val
  }
})

watch(currentApplicationId, () => {
  timelineItems.value = []
  timelineLoaded.value = false
  timelineError.value = null
})

watch(currentApplicationId, async (id) => {
  if (!id) return
  await executeDetailFetch()
}, { immediate: true })

async function loadTimeline() {
  const candId = resolvedCurrentApplication.value?.candidate?.id
  if (!candId) return
  timelineLoading.value = true
  timelineError.value = null
  try {
    const result = await $fetch<{ items: TimelineEntry[] }>('/api/activity-log/candidate-timeline', {
      query: { candidateId: candId },
    })
    timelineItems.value = result.items
    timelineLoaded.value = true
  } catch (err: any) {
    timelineError.value = err?.data?.statusMessage ?? t('dashboard.jobs.detail.failedToLoadTimeline')
  } finally {
    timelineLoading.value = false
  }
}

const timelineCandidateId = computed(() => resolvedCurrentApplication.value?.candidate?.id)

watch([detailTab, timelineCandidateId], () => {
  if (detailTab.value === 'timeline' && !timelineLoaded.value && timelineCandidateId.value) {
    loadTimeline()
  }
})

useSeoMeta({
  title: computed(() =>
    jobData.value ? `${t('dashboard.jobs.detail.pipeline')} — ${jobData.value.title}` : `${t('dashboard.jobs.detail.pipeline')}`,
  ),
  robots: 'noindex, nofollow',
})

// ─────────────────────────────────────────────
// Application status transitions
// ─────────────────────────────────────────────

const statusBadgeClasses: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  screening: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  interview: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  offer: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400',
  hired: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
  rejected: 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400',
}

const transitionLabels = computed<Record<string, string>>(() => ({
  new: t('dashboard.jobs.detail.transitionReopen'),
  screening: t('dashboard.jobs.detail.transitionScreening'),
  interview: t('dashboard.jobs.detail.transitionInterview'),
  offer: t('dashboard.jobs.detail.transitionOffer'),
  hired: t('dashboard.jobs.detail.transitionHired'),
  rejected: t('dashboard.jobs.detail.transitionReject'),
}))

const transitionClasses: Record<string, string> = {
  new: 'border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800',
  screening: 'bg-violet-600 text-white hover:bg-violet-700',
  interview: 'bg-amber-600 text-white hover:bg-amber-700',
  offer: 'bg-teal-600 text-white hover:bg-teal-700',
  hired: 'bg-green-700 text-white hover:bg-green-800',
  rejected: 'bg-danger-600 text-white hover:bg-danger-700',
}

function formatStatusLabel(status: string) {
  const key = `dashboard.applications.stages.${status}`
  return te(key) ? t(key) : status.charAt(0).toUpperCase() + status.slice(1)
}

function formatResponseValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? t('dashboard.jobs.detail.yes') : t('dashboard.jobs.detail.no')
  return String(value ?? '—')
}

function formatDocumentType(value: SwipeDocument['type']) {
  if (value === 'cover_letter') return t('dashboard.jobs.detail.docCoverLetter')
  if (value === 'resume') return t('dashboard.jobs.detail.docResume')
  return t('dashboard.jobs.detail.docOther')
}

function getCandidateInitials(firstName?: string, lastName?: string) {
  const first = firstName?.trim().charAt(0) ?? ''
  const last = lastName?.trim().charAt(0) ?? ''
  return `${first}${last}`.toUpperCase() || 'C'
}

function timeAgo(date: string | Date) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return t('common.timeAgo.minutes', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('common.timeAgo.hours', { n: hrs })
  const days = Math.floor(hrs / 24)
  if (days < 30) return t('common.timeAgo.days', { n: days })
  return new Date(date).toLocaleDateString()
}

function scoreClass(score: number) {
  if (score >= 75) return 'bg-success-50 text-success-700 dark:bg-success-950 dark:text-success-400'
  if (score >= 40) return 'bg-warning-50 text-warning-700 dark:bg-warning-950 dark:text-warning-400'
  return 'bg-danger-50 text-danger-700 dark:bg-danger-950 dark:text-danger-400'
}

const allowedTransitions = computed(() => {
  if (!currentSummary.value) return []
  return APPLICATION_STATUS_TRANSITIONS[currentSummary.value.status] ?? []
})

function isCurrentStatus(status: string) {
  return currentSummary.value?.status === status
}

function isStatusActionEnabled(status: string) {
  if (!currentSummary.value) return false
  if (isCurrentStatus(status)) return false
  return allowedTransitions.value.includes(status)
}

function isFocusStatus(status: PipelineStatus) {
  return focusStatus.value === status
}

function setFocusStatus(status: PipelineStatus) {
  focusStatus.value = status
}

function selectCandidate(index: number) {
  currentIndex.value = index
  showMobileDetail.value = true
}

const isMutating = ref(false)

// ─────────────────────────────────────────────
// Interview scheduling sidebar
// ─────────────────────────────────────────────

const showCandidateDrawer = ref(false)
const showInterviewSidebar = ref(false)
const interviewTargetApplication = ref<{ id: string; name: string } | null>(null)

function openInterviewScheduler() {
  if (!currentSummary.value) return
  interviewTargetApplication.value = {
    id: currentSummary.value.id,
    name: `${currentSummary.value.candidateFirstName} ${currentSummary.value.candidateLastName}`,
  }
  showInterviewSidebar.value = true
}

async function handleInterviewScheduled() {
  showInterviewSidebar.value = false
  const scheduledApplicationId = interviewTargetApplication.value?.id ?? currentSummary.value?.id
  interviewTargetApplication.value = null

  track('interview_scheduled')

  // Refresh the interviews list
  await refreshJobInterviews()

  // Transition the application status to 'interview' after scheduling
  if (currentSummary.value && currentSummary.value.status !== 'interview') {
    const allowed = APPLICATION_STATUS_TRANSITIONS[currentSummary.value.status] ?? []
    if (allowed.includes('interview')) {
      await changeStatus('interview')

      // Follow the candidate to the interview column so the user sees the scheduled interview
      if (scheduledApplicationId) {
        focusStatus.value = 'interview'
        await nextTick()
        const idx = filteredApplications.value.findIndex(a => a.id === scheduledApplicationId)
        if (idx !== -1) currentIndex.value = idx
      }
    }
  }
}

// ─────────────────────────────────────────────
// Interviews for this job
// ─────────────────────────────────────────────

const { data: jobInterviewsData, refresh: refreshJobInterviews } = useFetch<{ data: Interview[] }>('/api/interviews', {
  key: `pipeline-job-interviews-${jobId}`,
  query: { jobId, limit: 100 },
  headers: useRequestHeaders(['cookie']),
})

const jobInterviews = computed(() => jobInterviewsData.value?.data ?? [])

const currentApplicationInterviews = computed(() =>
  jobInterviews.value.filter(i => i.applicationId === currentApplicationId.value),
)

const applicationsWithInterviews = computed(() =>
  new Set(jobInterviews.value.map(i => i.applicationId)),
)

const interviewTypeIcons: Record<string, any> = {
  video: Video,
  phone: Phone,
  in_person: Building2,
  technical: Code2,
  panel: UsersRound,
  take_home: FileText,
}

const interviewTypeLabels = computed<Record<string, string>>(() => ({
  video: t('dashboard.jobs.detail.typeVideo'),
  phone: t('dashboard.jobs.detail.typePhone'),
  in_person: t('dashboard.jobs.detail.typeInPerson'),
  technical: t('dashboard.jobs.detail.typeTechnical'),
  panel: t('dashboard.jobs.detail.typePanel'),
  take_home: t('dashboard.jobs.detail.typeTakeHome'),
}))

const interviewStatusClasses: Record<string, string> = {
  scheduled: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-800',
  completed: 'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950/50 dark:text-success-300 dark:ring-success-800',
  cancelled: 'bg-surface-100 text-surface-500 ring-surface-200 dark:bg-surface-800/50 dark:text-surface-400 dark:ring-surface-700',
  no_show: 'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-950/50 dark:text-danger-300 dark:ring-danger-800',
}

function formatInterviewDateTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    + ' at '
    + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatInterviewDateTimeFull(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function isInterviewUpcoming(dateStr: string) {
  return new Date(dateStr) > new Date()
}

// ─────────────────────────────────────────────
// Interview inline editing
// ─────────────────────────────────────────────

type InterviewStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show'

function getAllowedInterviewTransitions(status: string): InterviewStatus[] {
  return (INTERVIEW_STATUS_TRANSITIONS[status] ?? []) as InterviewStatus[]
}

const interviewTransitionClasses: Record<InterviewStatus, string> = {
  scheduled: 'border border-surface-300 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800',
  completed: 'bg-success-600 text-white hover:bg-success-700',
  cancelled: 'bg-surface-500 text-white hover:bg-surface-600',
  no_show: 'bg-danger-600 text-white hover:bg-danger-700',
}

const interviewTransitionLabels = computed<Record<InterviewStatus, string>>(() => ({
  scheduled: t('dashboard.jobs.detail.interviewReschedule'),
  completed: t('dashboard.jobs.detail.interviewCompleted'),
  cancelled: t('dashboard.jobs.detail.interviewCancel'),
  no_show: t('dashboard.jobs.detail.interviewNoShow'),
}))

const interviewStatusIcons: Record<InterviewStatus, any> = {
  scheduled: Calendar,
  completed: CheckCircle2,
  cancelled: XCircle,
  no_show: AlertTriangle,
}

const expandedInterviewId = ref<string | null>(null)
const editingInterviewId = ref<string | null>(null)
const interviewEditForm = reactive({
  title: '',
  type: 'video' as string,
  location: '',
  notes: '',
  interviewers: [''] as string[],
})
const interviewEditErrors = ref<Record<string, string>>({})
const isInterviewSaving = ref(false)
const isInterviewTransitioning = ref(false)

// Reschedule state
const rescheduleInterviewId = ref<string | null>(null)
const rescheduleForm = reactive({
  date: '',
  time: '',
  duration: 60,
})
const isRescheduling = ref(false)
const rescheduleError = ref('')

function toggleInterviewExpand(id: string) {
  if (expandedInterviewId.value === id) {
    expandedInterviewId.value = null
    editingInterviewId.value = null
    rescheduleInterviewId.value = null
  } else {
    expandedInterviewId.value = id
    editingInterviewId.value = null
    rescheduleInterviewId.value = null
  }
}

function startInterviewEdit(iv: Interview) {
  editingInterviewId.value = iv.id
  interviewEditForm.title = iv.title
  interviewEditForm.type = iv.type
  interviewEditForm.location = iv.location ?? ''
  interviewEditForm.notes = iv.notes ?? ''
  interviewEditForm.interviewers = iv.interviewers?.length ? [...iv.interviewers] : ['']
  interviewEditErrors.value = {}
}

function cancelInterviewEdit() {
  editingInterviewId.value = null
  interviewEditErrors.value = {}
}

function addEditInterviewer() {
  interviewEditForm.interviewers.push('')
}

function removeEditInterviewer(idx: number) {
  interviewEditForm.interviewers.splice(idx, 1)
}

async function saveInterviewEdit() {
  interviewEditErrors.value = {}
  if (!interviewEditForm.title.trim()) {
    interviewEditErrors.value.title = t('dashboard.jobs.detail.titleRequired')
    return
  }

  isInterviewSaving.value = true
  try {
    const filteredInterviewers = interviewEditForm.interviewers.filter(i => i.trim())
    await $fetch(`/api/interviews/${editingInterviewId.value}`, {
      method: 'PATCH',
      body: {
        title: interviewEditForm.title.trim(),
        type: interviewEditForm.type,
        location: interviewEditForm.location.trim() || null,
        notes: interviewEditForm.notes.trim() || null,
        interviewers: filteredInterviewers.length > 0 ? filteredInterviewers : null,
      },
    })
    editingInterviewId.value = null
    await refreshJobInterviews()
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    interviewEditErrors.value.submit = err?.data?.statusMessage ?? t('dashboard.jobs.detail.failedToSaveChanges')
  } finally {
    isInterviewSaving.value = false
  }
}

async function handleInterviewTransition(interviewId: string, newStatus: InterviewStatus) {
  isInterviewTransitioning.value = true
  try {
    await $fetch(`/api/interviews/${interviewId}`, {
      method: 'PATCH',
      body: { status: newStatus },
    })
    await refreshJobInterviews()
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error(t('dashboard.jobs.detail.failedToUpdateStatus'), { message: err?.data?.statusMessage, statusCode: err?.data?.statusCode })
  } finally {
    isInterviewTransitioning.value = false
  }
}

function openReschedule(iv: Interview) {
  rescheduleInterviewId.value = iv.id
  const d = new Date(iv.scheduledAt)
  rescheduleForm.date = d.toISOString().slice(0, 10)
  rescheduleForm.time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  rescheduleForm.duration = iv.duration
  rescheduleError.value = ''
}

function cancelReschedule() {
  rescheduleInterviewId.value = null
  rescheduleError.value = ''
}

async function handleReschedule() {
  rescheduleError.value = ''
  if (!rescheduleForm.date || !rescheduleForm.time) {
    rescheduleError.value = t('dashboard.jobs.detail.dateTimeRequired')
    return
  }

  isRescheduling.value = true
  try {
    const scheduledAt = new Date(`${rescheduleForm.date}T${rescheduleForm.time}`).toISOString()
    await $fetch(`/api/interviews/${rescheduleInterviewId.value}`, {
      method: 'PATCH',
      body: {
        scheduledAt,
        duration: rescheduleForm.duration,
        status: 'scheduled',
      },
    })
    rescheduleInterviewId.value = null
    await refreshJobInterviews()
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    rescheduleError.value = err?.data?.statusMessage ?? t('dashboard.jobs.detail.failedToReschedule')
  } finally {
    isRescheduling.value = false
  }
}

async function changeStatus(status: string) {
  if (!currentSummary.value || isMutating.value) return
  const applicationId = currentSummary.value.id

  isMutating.value = true

  try {
    await $fetch(`/api/applications/${applicationId}`, {
      method: 'PATCH',
      body: { status },
    })

    track('pipeline_stage_changed', {
      from_stage: currentSummary.value.status,
      to_stage: status,
    })

    await refreshApps()

    // After the moved candidate disappears from the list, the items that came after
    // it shift up by one index. currentIndex now naturally points to the next
    // candidate — no change needed. We only clamp if currentIndex is now out of
    // bounds (i.e. the moved candidate was the last item in the filtered list).
    const newLen = filteredApplications.value.length
    if (newLen > 0 && currentIndex.value >= newLen) {
      currentIndex.value = newLen - 1
    }
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error(t('dashboard.jobs.detail.failedToUpdateStatus'), { message: err?.data?.statusMessage, statusCode: err?.data?.statusCode })
  } finally {
    isMutating.value = false
  }
}

function goToPreviousCard() {
  if (currentIndex.value === 0) return
  currentIndex.value -= 1
}

function goToNextCard() {
  if (currentIndex.value >= filteredApplications.value.length - 1) return
  currentIndex.value += 1
}

// ─────────────────────────────────────────────
// Fullscreen (focus) mode
// ─────────────────────────────────────────────
const isFullscreen = ref(false)
const pipelineContainer = useTemplateRef<HTMLElement>('pipelineContainer')
const teleportTarget = computed(() => isFullscreen.value && pipelineContainer.value ? pipelineContainer.value : 'body')

async function toggleFullscreen() {
  if (!isFullscreen.value) {
    isFullscreen.value = true
    await nextTick()
    pipelineContainer.value?.requestFullscreen?.()
  }
  else {
    isFullscreen.value = false
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
    }
  }
}

function onFullscreenChange() {
  if (!document.fullscreenElement) {
    isFullscreen.value = false
  }
}

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFullscreenChange))

function goToPreviousStage() {
  const idx = PIPELINE_STATUSES.indexOf(focusStatus.value)
  if (idx > 0) {
    focusStatus.value = PIPELINE_STATUSES[idx - 1]!
  }
}

function goToNextStage() {
  const idx = PIPELINE_STATUSES.indexOf(focusStatus.value)
  if (idx < PIPELINE_STATUSES.length - 1) {
    focusStatus.value = PIPELINE_STATUSES[idx + 1]!
  }
}

function handleKeyNavigation(event: KeyboardEvent) {
  if (event.key === 'Escape' && showDocPreview.value) {
    closeDocPreview()
    return
  }

  if ((event.target as HTMLElement)?.tagName === 'INPUT' || (event.target as HTMLElement)?.tagName === 'TEXTAREA' || (event.target as HTMLElement)?.tagName === 'SELECT') return

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    goToPreviousCard()
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    goToNextCard()
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    goToPreviousStage()
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    goToNextStage()
  }

  // Number keys 1-9 trigger status transition buttons
  const num = parseInt(event.key)
  if (num >= 1 && num <= 9 && allowedTransitions.value.length >= num) {
    event.preventDefault()
    const targetStatus = allowedTransitions.value[num - 1]!
    if (targetStatus === 'interview') {
      openInterviewScheduler()
    } else {
      changeStatus(targetStatus)
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyNavigation)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyNavigation)
})

// ─────────────────────────────────────────────
// Job status transitions (Publish, Close, etc.)
// ─────────────────────────────────────────────

const jobStatusBadgeClasses: Record<string, string> = {
  draft: 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400',
  open: 'bg-success-50 dark:bg-success-950 text-success-700 dark:text-success-400',
  closed: 'bg-warning-50 dark:bg-warning-950 text-warning-700 dark:text-warning-400',
  archived: 'bg-surface-100 dark:bg-surface-800 text-surface-400',
}

const isScoringIndividual = ref(false)

async function scoreIndividualCandidate(applicationId: string) {
  isScoringIndividual.value = true
  try {
    await $fetch(`/api/applications/${applicationId}/analyze`, {
      method: 'POST',
    })
    await refreshApps()
    // Re-fetch the detail so score updates in the detail panel
    if (currentApplicationId.value === applicationId) {
      await executeDetailFetch()
    }
    track('individual_scoring_completed', { application_id: applicationId })
    toast.success(t('dashboard.jobs.detail.candidateScored'), t('dashboard.jobs.detail.aiAnalysisComplete'))
  } catch (err: any) {
    const statusMessage = err?.data?.statusMessage ?? ''
    if (statusMessage.includes('AI provider not configured')) {
      toast.add({
        type: 'warning',
        title: t('dashboard.jobs.aiAnalysis.aiNotConfigured'),
        message: t('dashboard.jobs.detail.setupAiFirst'),
        link: { label: t('dashboard.jobs.aiAnalysis.goToAiSettings'), href: '/dashboard/settings/ai' },
        duration: 8000,
      })
    } else if (statusMessage.includes('No scoring criteria')) {
      toast.warning(t('dashboard.jobs.detail.noScoringCriteria'), t('dashboard.jobs.detail.addScoringCriteria'))
    } else {
      toast.error(t('dashboard.jobs.detail.scoringFailed'), { message: statusMessage || t('dashboard.jobs.detail.unexpectedError'), statusCode: err?.data?.statusCode })
    }
  } finally {
    isScoringIndividual.value = false
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOverviewDropdownClickOutside)
})

const isLoading = computed(() => {
  return jobFetchStatus.value === 'pending' || appFetchStatus.value === 'pending'
})

// ─────────────────────────────────────────────
// Document preview
// ─────────────────────────────────────────────

const { getPreviewUrl } = useDocuments()

const showDocPreview = ref(false)
const docPreviewUrl = ref<string | null>(null)
const docPreviewFilename = ref('')
const docPreviewMimeType = ref('')
const docPreviewDocId = ref<string | null>(null)

const isDocPreviewPdf = computed(() => docPreviewMimeType.value === 'application/pdf')

function handleDocPreview(doc: SwipeDocument) {
  track('document_viewed', { document_type: doc.type, mime_type: doc.mimeType })
  if (doc.mimeType !== 'application/pdf') {
    // Non-PDFs: fall back to download
    window.open(`/api/documents/${doc.id}/download`, '_blank')
    return
  }
  docPreviewDocId.value = doc.id
  docPreviewFilename.value = doc.originalFilename
  docPreviewMimeType.value = doc.mimeType
  docPreviewUrl.value = getPreviewUrl(doc.id)
  showDocPreview.value = true
}

function closeDocPreview() {
  showDocPreview.value = false
  docPreviewUrl.value = null
  docPreviewFilename.value = ''
  docPreviewMimeType.value = ''
  docPreviewDocId.value = null
}
</script>

<template>
  <div
    ref="pipelineContainer"
    :class="isFullscreen
      ? 'flex h-screen flex-col overflow-hidden bg-surface-50 dark:bg-surface-950'
      : 'absolute inset-0 flex flex-col overflow-hidden'"
  >
    <!-- Loading -->
    <div v-if="isLoading" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="size-8 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin" />
      <p class="text-sm font-medium text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.detail.loadingPipeline') }}</p>
    </div>

    <!-- Error -->
    <div
      v-else-if="jobError || appError"
      class="m-6 rounded-xl border border-danger-200/80 bg-danger-50 p-5 text-sm text-danger-700 dark:border-danger-800/60 dark:bg-danger-950/40 dark:text-danger-300"
    >
      {{ jobError ? t('dashboard.jobs.detail.jobNotFound') : t('dashboard.jobs.detail.failedToLoadApps') }}
      <NuxtLink :to="$localePath('/dashboard')" class="ml-1 font-medium underline hover:no-underline">{{ t('dashboard.jobs.detail.backToJobs') }}</NuxtLink>
    </div>

    <template v-else-if="jobData">
      <!-- Quick actions teleported to sub-nav bar -->
      <JobSubNavActions :job-id="jobId" />

      <!-- Keyboard shortcut hints in sub-nav bar (pipeline-specific) -->
      <Teleport to="#job-sub-nav-actions">
        <div class="hidden sm:flex items-center gap-2 text-[10px] font-medium text-surface-400 dark:text-surface-500">
          <div class="flex items-center gap-1 rounded-md bg-surface-100/80 px-2 py-0.5 dark:bg-surface-800/60">
            <span class="font-mono text-[10px]">↑↓</span>
            <span>{{ t('dashboard.jobs.detail.kbCandidates') }}</span>
          </div>
          <div class="flex items-center gap-1 rounded-md bg-surface-100/80 px-2 py-0.5 dark:bg-surface-800/60">
            <span class="font-mono text-[10px]">←→</span>
            <span>{{ t('dashboard.jobs.detail.kbStages') }}</span>
          </div>
          <div class="flex items-center gap-1 rounded-md bg-surface-100/80 px-2 py-0.5 dark:bg-surface-800/60">
            <span class="font-mono text-[10px]">1-9</span>
            <span>{{ t('dashboard.jobs.detail.kbActions') }}</span>
          </div>
        </div>
      </Teleport>

      <!-- ═══════════════════════════════════════ -->
      <!-- PIPELINE STATUS TABS                     -->
      <!-- ═══════════════════════════════════════ -->
      <div class="shrink-0 border-b border-surface-200/80 bg-white dark:border-surface-800/60 dark:bg-surface-900">
        <div class="flex items-center gap-1 overflow-x-auto scrollbar-thin sm:scrollbar-none px-3 sm:px-5 py-2">
          <button
            v-for="status in PIPELINE_STATUSES"
            :key="`tab-${status}`"
            class="relative flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200 focus:outline-none"
            :class="isFocusStatus(status)
              ? 'bg-brand-50 text-brand-700 shadow-sm ring-1 ring-brand-200/60 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-800/40'
              : 'text-surface-500 hover:bg-surface-50 hover:text-surface-700 dark:text-surface-400 dark:hover:bg-surface-800/60 dark:hover:text-surface-200'"
            @click="setFocusStatus(status)"
          >
            <span class="pipeline-status-dot size-2 rounded-full" :class="{
              'bg-blue-500 dark:bg-blue-400': status === 'new',
              'bg-violet-500 dark:bg-violet-400': status === 'screening',
              'bg-amber-500 dark:bg-amber-400': status === 'interview',
              'bg-teal-500 dark:bg-teal-400': status === 'offer',
              'bg-green-600 dark:bg-green-300': status === 'hired',
              'bg-surface-400 dark:bg-surface-500': status === 'rejected',
            }" />
            {{ formatStatusLabel(status) }}
            <span
              class="inline-flex min-w-[20px] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition-colors duration-200"
              :class="isFocusStatus(status)
                ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300'
                : 'bg-surface-100 text-surface-500 dark:bg-surface-800/80 dark:text-surface-400'"
            >
              {{ statusCounts[status] ?? 0 }}
            </span>
          </button>

          <!-- Sprint 3: счётчики источников + тумблер «Скрыть холодных» -->
          <div class="ml-auto flex items-center gap-2">
            <div
              class="hidden md:flex items-center gap-2 text-[11px] text-surface-500 dark:text-surface-400"
              :title="`Всего: ${sourceCounts.total} · Отклики hh: ${sourceCounts.hh} · Холодные: ${sourceCounts.cold} · Вручную: ${sourceCounts.manual} · API: ${sourceCounts.api}`"
            >
              <span class="font-semibold text-surface-700 dark:text-surface-200">{{ sourceCounts.total }}</span>
              <span class="inline-flex items-center gap-0.5" :class="sourceCounts.hh > 0 ? 'text-blue-600 dark:text-blue-400' : ''">
                <Inbox class="size-3" />{{ sourceCounts.hh }}
              </span>
              <span class="inline-flex items-center gap-0.5" :class="sourceCounts.cold > 0 ? 'text-sky-600 dark:text-sky-400' : ''">
                <Snowflake class="size-3" />{{ sourceCounts.cold }}
              </span>
              <span class="inline-flex items-center gap-0.5" :class="sourceCounts.manual > 0 ? 'text-slate-600 dark:text-slate-300' : ''">
                <UserPlus class="size-3" />{{ sourceCounts.manual }}
              </span>
            </div>
            <button
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-200"
              :class="hideColdSourcing
                ? 'bg-sky-100 text-sky-800 hover:bg-sky-200 dark:bg-sky-950 dark:text-sky-300'
                : 'text-surface-500 hover:bg-surface-100 hover:text-surface-700 dark:text-surface-400 dark:hover:bg-surface-800'"
              :title="hideColdSourcing ? 'Холодные скрыты. Нажмите чтобы показать.' : 'Скрыть hh-сорсинг-кандидатов (показать только отклики и ручные)'"
              @click="hideColdSourcing = !hideColdSourcing"
            >
              <Snowflake class="size-3.5" />
              <span class="hidden sm:inline">{{ hideColdSourcing ? 'Показать холодных' : 'Скрыть холодных' }}</span>
            </button>
            <!-- Fullscreen toggle -->
            <button
              class="flex shrink-0 cursor-pointer items-center justify-center rounded-lg p-2 text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:text-surface-500 dark:hover:bg-surface-800 dark:hover:text-surface-300 transition-all duration-200 focus:outline-none"
              :title="isFullscreen ? t('dashboard.jobs.detail.exitFocusMode') : t('dashboard.jobs.detail.focusMode')"
              @click="toggleFullscreen"
            >
              <Minimize2 v-if="isFullscreen" class="size-4" />
              <Maximize2 v-else class="size-4" />
            </button>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- THREE-PANEL LAYOUT                       -->
      <!-- ═══════════════════════════════════════ -->
      <div class="flex flex-1 min-h-0 overflow-hidden">

        <!-- LEFT PANEL — Candidate list (desktop only; mobile uses bottom bar) -->
        <div
          class="hidden md:flex md:w-72 md:shrink-0 flex-col border-r border-surface-200/80 bg-white dark:border-surface-800/60 dark:bg-surface-900"
        >
          <!-- Search + Sort + Filter controls -->
          <div class="shrink-0 px-3.5 pt-3 pb-2 space-y-2 dark:border-surface-800">
            <!-- Search input -->
            <div class="relative">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-surface-400 dark:text-surface-500" />
              <input
                v-model="searchTerm"
                type="text"
:placeholder="t('dashboard.jobs.detail.searchCandidates')"
                class="w-full rounded-lg border border-surface-200/80 bg-surface-50/80 py-2 pl-8 pr-3 text-sm text-surface-900 placeholder:text-surface-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-surface-700/80 dark:bg-surface-800/60 dark:text-surface-100 dark:placeholder:text-surface-500 dark:focus:border-brand-500 dark:focus:ring-brand-500/20 transition-all duration-150"
                @focus="closePanels"
              />
            </div>

            <!-- Sort & Filter row -->
            <div class="flex items-center gap-1.5">
              <!-- Sort dropdown -->
              <div class="relative flex-1 min-w-0">
                <button
                  class="flex w-full cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-all duration-150"
                  :class="showSortPanel
                    ? 'border-brand-300 bg-brand-50/50 text-brand-700 dark:border-brand-600 dark:bg-brand-950/30 dark:text-brand-300'
                    : 'border-surface-200/80 bg-surface-50/50 text-surface-600 hover:border-surface-300 hover:bg-surface-50 dark:border-surface-700/80 dark:bg-surface-800/40 dark:text-surface-300 dark:hover:border-surface-600 dark:hover:bg-surface-800'"
                  @click="showSortPanel = !showSortPanel; showFilterPanel = false"
                >
                  <ArrowUpDown class="size-3 shrink-0" />
                  <span class="truncate text-[11px] font-medium">{{ currentSortLabel }}</span>
                  <ChevronDown class="ml-auto size-3 shrink-0 transition-transform duration-150" :class="showSortPanel ? 'rotate-180' : ''" />
                </button>

                <!-- Sort dropdown panel -->
                <Transition
                  enter-active-class="transition duration-150 ease-out"
                  enter-from-class="opacity-0 scale-95 -translate-y-1"
                  enter-to-class="opacity-100 scale-100 translate-y-0"
                  leave-active-class="transition duration-100 ease-in"
                  leave-from-class="opacity-100 scale-100 translate-y-0"
                  leave-to-class="opacity-0 scale-95 -translate-y-1"
                >
                  <div
                    v-if="showSortPanel"
                    class="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-surface-200 bg-white py-1 shadow-lg shadow-surface-900/5 dark:border-surface-700 dark:bg-surface-900 dark:shadow-black/20 origin-top"
                  >
                    <button
                      v-for="option in sortOptions"
                      :key="option.value"
                      class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] font-medium transition-colors"
                      :class="sortBy === option.value
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                        : 'text-surface-600 hover:bg-surface-50 dark:text-surface-300 dark:hover:bg-surface-800'"
                      @click="selectSort(option.value)"
                    >
                      <Check v-if="sortBy === option.value" class="size-3 shrink-0" />
                      <span v-else class="size-3 shrink-0" />
                      {{ option.label }}
                    </button>
                  </div>
                </Transition>
              </div>

              <!-- Filter button -->
              <button
                class="relative flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1.5 transition-all duration-150"
                :class="showFilterPanel || hasActiveFilters
                  ? 'border-brand-300 bg-brand-50/50 text-brand-700 dark:border-brand-600 dark:bg-brand-950/30 dark:text-brand-300'
                  : 'border-surface-200/80 bg-surface-50/50 text-surface-600 hover:border-surface-300 hover:bg-surface-50 dark:border-surface-700/80 dark:bg-surface-800/40 dark:text-surface-300 dark:hover:border-surface-600 dark:hover:bg-surface-800'"
                @click="showFilterPanel = !showFilterPanel; showSortPanel = false"
              >
                <ListFilter class="size-3" />
                <span
                  v-if="activeFilterCount > 0"
                  class="flex size-3.5 items-center justify-center rounded-full bg-brand-600 text-[9px] font-bold text-white dark:bg-brand-500"
                >
                  {{ activeFilterCount }}
                </span>
              </button>
            </div>

            <!-- Filter panel -->
            <Transition
              enter-active-class="transition duration-150 ease-out"
              enter-from-class="opacity-0 -translate-y-1"
              enter-to-class="opacity-100 translate-y-0"
              leave-active-class="transition duration-100 ease-in"
              leave-from-class="opacity-100 translate-y-0"
              leave-to-class="opacity-0 -translate-y-1"
            >
              <div
                v-if="showFilterPanel"
                class="rounded-lg border border-surface-200/80 bg-surface-50/80 p-2.5 space-y-2.5 dark:border-surface-700/80 dark:bg-surface-800/40"
              >
                <!-- Score filter -->
                <div>
                  <p class="text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1">{{ t('dashboard.jobs.detail.filterScore') }}</p>
                  <div class="flex flex-wrap gap-1">
                    <button
                      v-for="opt in scoreFilterOptions"
                      :key="opt.value"
                      class="cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-all duration-150"
                      :class="scoreFilter === opt.value
                        ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
                        : 'bg-white text-surface-600 ring-1 ring-inset ring-surface-200 hover:bg-surface-50 dark:bg-surface-800 dark:text-surface-300 dark:ring-surface-700 dark:hover:bg-surface-700'"
                      @click="scoreFilter = opt.value"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </div>

                <!-- Interview filter -->
                <div>
                  <p class="text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1">{{ t('dashboard.jobs.detail.filterInterview') }}</p>
                  <div class="flex flex-wrap gap-1">
                    <button
                      v-for="opt in interviewFilterOptions"
                      :key="opt.value"
                      class="cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-all duration-150"
                      :class="interviewFilter === opt.value
                        ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
                        : 'bg-white text-surface-600 ring-1 ring-inset ring-surface-200 hover:bg-surface-50 dark:bg-surface-800 dark:text-surface-300 dark:ring-surface-700 dark:hover:bg-surface-700'"
                      @click="interviewFilter = opt.value"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </div>

                <!-- Property filters -->
                <div>
                  <p class="text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1.5">{{ t('dashboard.jobs.detail.filterProperties') }}</p>
                  <PropertyFilterBar
                    v-model="propertyFilters"
                    entity-type="application"
                    :job-id="jobId"
                  />
                </div>

                <!-- Clear filters -->
                <button
                  v-if="hasActiveFilters"
                  class="flex w-full cursor-pointer items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200 transition-colors"
                  @click="clearFilters"
                >
                  <X class="size-3" />
                  {{ t('dashboard.jobs.detail.clearFilters') }}
                </button>
              </div>
            </Transition>
          </div>

          <!-- Count bar -->
          <div class="shrink-0 px-3.5 pb-2 flex items-center justify-between">
            <span class="text-xs font-medium text-surface-500 dark:text-surface-400">
              {{ filteredApplications.length }} {{ filteredApplications.length === 1 ? t('dashboard.jobs.detail.candidateSingular') : t('dashboard.jobs.detail.candidatePlural') }}
              <span v-if="searchTerm.trim() || hasActiveFilters" class="text-surface-400 dark:text-surface-500">
                {{ hasActiveFilters ? t('dashboard.jobs.detail.filtered') : t('dashboard.jobs.detail.matching') }}
              </span>
            </span>
            <span v-if="hasActiveFilters && filteredApplications.length !== focusedApplications.length" class="text-[10px] text-surface-400 dark:text-surface-500">
              of {{ focusedApplications.length }}
            </span>
            <span v-if="isLoadingMore" class="flex items-center gap-1 text-[10px] text-surface-400 dark:text-surface-500">
              <Loader2 class="size-3 animate-spin" />
              Дозагружаем… ({{ applications.length }} / {{ total }})
            </span>
          </div>

          <!-- Scrollable list -->
          <div class="flex-1 overflow-y-auto scrollbar-thin border-t border-surface-100 dark:border-surface-800/60">
            <div v-if="filteredApplications.length === 0" class="p-8 text-center">
              <div class="flex size-12 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                <UserRound class="size-5 text-surface-400 dark:text-surface-500" />
              </div>
              <p class="text-sm font-medium text-surface-600 dark:text-surface-300">
                {{ (searchTerm.trim() || hasActiveFilters) ? t('dashboard.jobs.detail.noMatchingCandidates') : t('dashboard.jobs.detail.noCandidatesYet') }}
              </p>
              <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">
                {{ (searchTerm.trim() || hasActiveFilters) ? t('dashboard.jobs.detail.tryAdjusting') : t('dashboard.jobs.detail.noOneInStage', { stage: formatStatusLabel(focusStatus) }) }}
              </p>
              <button
                v-if="hasActiveFilters"
                class="mt-2 cursor-pointer text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                @click="clearFilters"
              >
                {{ t('dashboard.jobs.detail.clearFilters') }}
              </button>
            </div>

            <button
              v-for="(app, idx) in filteredApplications"
              :key="app.id"
              class="pipeline-candidate-card group flex w-full cursor-pointer items-start gap-3 px-3.5 py-3 text-left transition-all duration-150"
              :class="currentIndex === idx
                ? 'bg-brand-50/70 dark:bg-brand-950/20 border-l-[3px] border-l-brand-500 dark:border-l-brand-400'
                : 'border-l-[3px] border-l-transparent hover:bg-surface-50/80 dark:hover:bg-surface-800/40'"
              @click="selectCandidate(idx)"
            >
              <div
                class="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-150"
                :class="currentIndex === idx
                  ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/20 dark:bg-brand-600 dark:shadow-brand-500/10'
                  : 'bg-surface-100 text-surface-600 group-hover:bg-brand-100 group-hover:text-brand-700 dark:bg-surface-800 dark:text-surface-300 dark:group-hover:bg-brand-950 dark:group-hover:text-brand-300'"
              >
                {{ getCandidateInitials(app.candidateFirstName, app.candidateLastName) }}
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-surface-900 dark:text-surface-100">
                  {{ formatPersonName(app.candidateFirstName, app.candidateLastName) }}
                </p>
                <p class="mt-0.5 block truncate text-xs text-surface-500 dark:text-surface-400">{{ app.candidateEmail }}</p>
                <div class="mt-1.5 flex items-center gap-2">
                  <!-- Sprint 3: иконка источника application (отклик/холодный/ручной/внешний) -->
                  <component
                    :is="getApplicationSourceMeta((app as any).source).icon"
                    :class="['size-3.5', getApplicationSourceMeta((app as any).source).iconClass]"
                    :title="getApplicationSourceMeta((app as any).source).tooltip"
                  />
                  <span
                    v-if="app.score != null"
                    class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset"
                    :class="{
                      'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950/60 dark:text-success-400 dark:ring-success-800': app.score >= 75,
                      'bg-warning-50 text-warning-700 ring-warning-200 dark:bg-warning-950/60 dark:text-warning-400 dark:ring-warning-800': app.score >= 40 && app.score < 75,
                      'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-950/60 dark:text-danger-400 dark:ring-danger-800': app.score < 40,
                    }"
                  >
                    {{ app.score }} {{ t('common.points') }}
                  </span>
                  <span class="text-[11px] text-surface-400 dark:text-surface-500">{{ timeAgo(app.createdAt) }}</span>
                  <span v-if="applicationsWithInterviews.has(app.id)" class="inline-flex items-center text-warning-500 dark:text-warning-400" :title="t('dashboard.jobs.detail.interviewScheduledHint')">
                    <Calendar class="size-3" />
                  </span>
                </div>
              </div>
            </button>
          </div>
        </div>

        <!-- CENTER PANEL — Candidate detail -->
        <div
          class="flex flex-1 flex-col overflow-hidden"
        >

          <!-- Empty state -->
          <div
            v-if="!currentSummary"
            class="flex flex-1 flex-col items-center justify-center p-8 text-center"
          >
            <div class="flex size-16 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mb-4">
              <UserRound class="size-7 text-surface-400 dark:text-surface-500" />
            </div>
            <p class="text-base font-semibold text-surface-700 dark:text-surface-200">
              {{ t('dashboard.jobs.detail.noCandidatesIn', { stage: formatStatusLabel(focusStatus) }) }}
            </p>
            <p class="mt-1.5 text-sm text-surface-500 dark:text-surface-400 max-w-xs">
              {{ t('dashboard.jobs.detail.switchStage') }}
            </p>
          </div>

          <template v-else>
            <!-- Sticky status transitions (stays visible on scroll) -->
            <div v-if="allowedTransitions.length > 0" class="shrink-0 border-b border-surface-200/80 bg-white/95 backdrop-blur-sm px-4 sm:px-6 py-2.5 dark:border-surface-800/60 dark:bg-surface-900/95">
              <div class="mx-auto max-w-4xl flex flex-wrap items-center gap-1.5 sm:gap-2">
                <button
                  v-for="(nextStatus, idx) in allowedTransitions"
                  :key="nextStatus"
                  :disabled="isMutating"
                  class="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm inline-flex items-center gap-1.5"
                  :class="transitionClasses[nextStatus] ?? 'border border-surface-300 text-surface-600 hover:bg-surface-50'"
                  @click="nextStatus === 'interview' ? openInterviewScheduler() : changeStatus(nextStatus)"
                >
                  {{ transitionLabels[nextStatus] ?? nextStatus }}
                  <kbd class="inline-flex items-center justify-center rounded px-1 py-0.5 text-[10px] font-mono leading-none opacity-60 bg-black/10 dark:bg-white/10 min-w-[16px]">{{ idx + 1 }}</kbd>
                </button>
              </div>
            </div>

            <!-- Scrollable container: header + tabs + content -->
            <div ref="detailScrollContainer" class="flex-1 overflow-y-auto scrollbar-thin pb-20 md:pb-0">

            <!-- Candidate header -->
            <div class="border-b border-surface-200 bg-surface-50 px-4 sm:px-6 py-4 sm:py-6 dark:border-surface-800 dark:bg-surface-900/80">
              <div class="mx-auto max-w-4xl">
              <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div class="flex items-start gap-4 min-w-0">
                  <div class="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-lg font-bold text-white shadow-lg shadow-brand-500/20 dark:from-brand-500 dark:to-brand-700 dark:shadow-brand-500/10">
                    {{ getCandidateInitials(currentSummary.candidateFirstName, currentSummary.candidateLastName) }}
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2.5">
                      <h2 class="text-xl font-semibold tracking-tight text-surface-900 dark:text-surface-50 truncate">
                        {{ formatPersonName(currentSummary.candidateFirstName, currentSummary.candidateLastName) }}
                      </h2>
                      <span
                        class="inline-flex shrink-0 items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset"
                        :class="{
                          'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:ring-blue-800': currentSummary.status === 'new',
                          'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-400 dark:ring-violet-800': currentSummary.status === 'screening',
                          'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:ring-amber-800': currentSummary.status === 'interview',
                          'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/50 dark:text-teal-400 dark:ring-teal-800': currentSummary.status === 'offer',
                          'bg-green-50 text-green-700 ring-green-200 dark:bg-green-950/50 dark:text-green-400 dark:ring-green-800': currentSummary.status === 'hired',
                          'bg-surface-100 text-surface-500 ring-surface-200 dark:bg-surface-800/50 dark:text-surface-400 dark:ring-surface-700': currentSummary.status === 'rejected',
                        }"
                      >
                        {{ formatStatusLabel(currentSummary.status) }}
                      </span>
                    </div>
                    <div class="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-surface-500 dark:text-surface-400">
                      <a
                        :href="`mailto:${currentSummary.candidateEmail}`"
                        target="_blank"
                        class="inline-flex items-center gap-1.5 hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
                      >
                        <Mail class="size-3.5" />
                        {{ currentSummary.candidateEmail }}
                      </a>
                      <span v-if="resolvedCurrentApplication?.candidate.phone" class="inline-flex items-center gap-1.5">
                        <Phone class="size-3.5" />
                        {{ resolvedCurrentApplication.candidate.phone }}
                      </span>
                    </div>
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        v-if="currentSummary.score != null"
                        class="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset"
                        :class="{
                          'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950/60 dark:text-success-400 dark:ring-success-800': currentSummary.score >= 75,
                          'bg-warning-50 text-warning-700 ring-warning-200 dark:bg-warning-950/60 dark:text-warning-400 dark:ring-warning-800': currentSummary.score >= 40 && currentSummary.score < 75,
                          'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-950/60 dark:text-danger-400 dark:ring-danger-800': currentSummary.score < 40,
                        }"
                      >
                        {{ currentSummary.score }} {{ t('common.points') }}
                      </span>
                      <button
                        :disabled="isScoringIndividual"
                        class="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                        :class="currentSummary.score != null
                          ? 'text-surface-500 hover:text-brand-600 hover:bg-brand-50 dark:text-surface-400 dark:hover:text-brand-400 dark:hover:bg-brand-950/40'
                          : 'text-brand-600 bg-brand-50 hover:bg-brand-100 dark:text-brand-400 dark:bg-brand-950/40 dark:hover:bg-brand-950/60 ring-1 ring-brand-200 dark:ring-brand-800'"
                        @click="scoreIndividualCandidate(currentSummary.id)"
                      >
                        <Loader2 v-if="isScoringIndividual" class="size-3 animate-spin" />
                        <Brain v-else class="size-3" />
                        {{ isScoringIndividual ? t('dashboard.jobs.detail.scoring') : (currentSummary.score != null ? t('dashboard.jobs.detail.rescore') : t('dashboard.jobs.detail.scoreCandidate')) }}
                      </button>
                      <button
                        v-if="resolvedCurrentApplication?.candidate?.id"
                        class="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-surface-500 transition-all duration-150 hover:text-brand-600 hover:bg-brand-50 dark:text-surface-400 dark:hover:text-brand-400 dark:hover:bg-brand-950/40"
                        title="Открыть карточку кандидата"
                        @click="showCandidateDrawer = true"
                      >
                        <UserRound class="size-3" />
                        Карточка
                      </button>
                      <TimelineDateLink :date="currentSummary.createdAt" class="inline-flex items-center gap-1 text-[11px] text-surface-400 dark:text-surface-500">
                        <Clock class="size-3" />
                        {{ t('dashboard.jobs.detail.applied') }} {{ new Date(currentSummary.createdAt).toLocaleDateString() }}
                      </TimelineDateLink>
                      <span v-if="currentSummary.updatedAt !== currentSummary.createdAt" class="inline-flex items-center gap-1 text-[11px] text-surface-400 dark:text-surface-500">
                        · <TimelineDateLink :date="currentSummary.updatedAt">{{ t('dashboard.jobs.detail.updated') }} {{ new Date(currentSummary.updatedAt).toLocaleDateString() }}</TimelineDateLink>
                      </span>
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <div class="flex items-center gap-1.5 mr-2">
                    <button
                      :disabled="currentIndex === 0"
                      class="flex cursor-pointer items-center justify-center rounded-lg border border-surface-200 p-1.5 text-surface-500 transition-all duration-150 hover:bg-white hover:border-surface-300 hover:text-surface-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:border-surface-600 dark:hover:text-surface-300"
                      @click="goToPreviousCard"
                    >
                      <ArrowLeft class="size-4" />
                    </button>
                    <span class="text-xs font-medium text-surface-500 dark:text-surface-400 tabular-nums px-0.5">
                      {{ currentIndex + 1 }}/{{ filteredApplications.length }}
                    </span>
                    <button
                      :disabled="currentIndex >= filteredApplications.length - 1"
                      class="flex cursor-pointer items-center justify-center rounded-lg border border-surface-200 p-1.5 text-surface-500 transition-all duration-150 hover:bg-white hover:border-surface-300 hover:text-surface-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:border-surface-600 dark:hover:text-surface-300"
                      @click="goToNextCard"
                    >
                      <ArrowRight class="size-4" />
                    </button>
                  </div>
                  <NuxtLink
                    :to="$localePath(`/dashboard/applications/${currentSummary.id}`)"
                    class="flex items-center justify-center rounded-lg border border-surface-200 p-1.5 text-surface-500 transition-all duration-150 hover:bg-white hover:border-surface-300 hover:text-surface-700 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:border-surface-600 dark:hover:text-surface-300"
:title="t('dashboard.jobs.detail.fullApplicationPage')"
                  >
                    <ExternalLink class="size-4" />
                  </NuxtLink>
                </div>
              </div>
              </div>
            </div>

            <!-- Detail tabs -->
            <div class="border-b border-surface-200/80 bg-white px-4 sm:px-6 dark:border-surface-800/60 dark:bg-surface-900">
              <div class="mx-auto max-w-4xl flex gap-1 -mb-px scrollbar-none whitespace-nowrap" :class="showOverviewDropdown ? '' : 'overflow-x-auto'">
                <div ref="overviewDropdownRef" class="relative">
                  <div class="flex items-center border-b-2 transition-all duration-150" :class="detailTab === 'overview'
                    ? 'border-brand-600 dark:border-brand-400'
                    : 'border-transparent'">
                    <button
                      class="cursor-pointer px-3.5 py-2.5 text-sm font-medium transition-all duration-150"
                      :class="detailTab === 'overview'
                        ? 'text-brand-700 dark:text-brand-300'
                        : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300'"
                      @click="detailTab = 'overview'"
                    >
                      {{ t('dashboard.jobs.detail.tabOverview') }}
                    </button>
                    <button
                      v-if="detailTab === 'overview'"
                      class="cursor-pointer -ml-2 p-1 rounded transition-colors duration-150 text-surface-400 hover:text-surface-600 dark:text-surface-500 dark:hover:text-surface-300"
                      @click.stop="showOverviewDropdown = !showOverviewDropdown"
                    >
                      <ChevronDown class="size-3.5 transition-transform duration-150" :class="showOverviewDropdown ? 'rotate-180' : ''" />
                    </button>
                  </div>

                  <!-- Overview sections dropdown -->
                  <Transition
                    enter-active-class="transition duration-150 ease-out"
                    enter-from-class="opacity-0 scale-95 -translate-y-1"
                    enter-to-class="opacity-100 scale-100 translate-y-0"
                    leave-active-class="transition duration-100 ease-in"
                    leave-from-class="opacity-100 scale-100 translate-y-0"
                    leave-to-class="opacity-0 scale-95 -translate-y-1"
                  >
                    <div
                      v-if="showOverviewDropdown"
                      class="absolute left-0 top-full z-50 mt-1 w-44 rounded-xl border border-surface-200 dark:border-surface-700/80 bg-white dark:bg-surface-900 shadow-xl shadow-surface-900/5 dark:shadow-black/20 py-1.5 origin-top-left"
                    >
                      <span class="block px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.detail.sections') }}</span>
                      <label class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/80 cursor-pointer select-none transition-colors">
                        <input v-model="overviewSections.aiAnalysis" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-600 dark:bg-surface-800" />
                        {{ t('dashboard.jobs.detail.tabAiAnalysis') }}
                      </label>
                      <label class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/80 cursor-pointer select-none transition-colors">
                        <input v-model="overviewSections.interviews" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-600 dark:bg-surface-800" />
                        {{ t('dashboard.jobs.detail.tabInterviews') }}
                      </label>
                      <label class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/80 cursor-pointer select-none transition-colors">
                        <input v-model="overviewSections.documents" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-600 dark:bg-surface-800" />
                        {{ t('dashboard.jobs.detail.tabDocuments') }}
                      </label>
                      <label class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/80 cursor-pointer select-none transition-colors">
                        <input v-model="overviewSections.responses" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-600 dark:bg-surface-800" />
                        {{ t('dashboard.jobs.detail.tabResponses') }}
                      </label>
                      <label class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/80 cursor-pointer select-none transition-colors">
                        <input v-model="overviewSections.properties" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-600 dark:bg-surface-800" />
                        {{ t('dashboard.jobs.detail.tabProperties') }}
                      </label>
                    </div>
                  </Transition>
                </div>
                <button
                  class="cursor-pointer px-3.5 py-2.5 text-sm font-medium transition-all duration-150 border-b-2 -mb-px"
                  :class="detailTab === 'ai-analysis'
                    ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                    : 'border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300 dark:text-surface-400 dark:hover:text-surface-300 dark:hover:border-surface-600'"
                  @click="detailTab = 'ai-analysis'"
                >
                  {{ t('dashboard.jobs.tabs.aiAnalysis') }}
                </button>
                <button
                  class="cursor-pointer px-3.5 py-2.5 text-sm font-medium transition-all duration-150 border-b-2 -mb-px"
                  :class="detailTab === 'interviews'
                    ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                    : 'border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300 dark:text-surface-400 dark:hover:text-surface-300 dark:hover:border-surface-600'"
                  @click="detailTab = 'interviews'"
                >
                  {{ t('dashboard.jobs.detail.tabInterviews') }}
                  <span
                    v-if="currentApplicationInterviews.length > 0"
                    class="ml-1 text-xs text-surface-400"
                  >
                    ({{ currentApplicationInterviews.length }})
                  </span>
                </button>
                <button
                  class="cursor-pointer px-3.5 py-2.5 text-sm font-medium transition-all duration-150 border-b-2 -mb-px"
                  :class="detailTab === 'documents'
                    ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                    : 'border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300 dark:text-surface-400 dark:hover:text-surface-300 dark:hover:border-surface-600'"
                  @click="detailTab = 'documents'"
                >
                  {{ t('dashboard.jobs.detail.tabDocuments') }}
                  <span
                    v-if="resolvedCurrentApplication?.candidate.documents?.length"
                    class="ml-1 text-xs text-surface-400"
                  >
                    ({{ resolvedCurrentApplication.candidate.documents.length }})
                  </span>
                </button>
                <button
                  class="cursor-pointer px-3.5 py-2.5 text-sm font-medium transition-all duration-150 border-b-2 -mb-px"
                  :class="detailTab === 'responses'
                    ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                    : 'border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300 dark:text-surface-400 dark:hover:text-surface-300 dark:hover:border-surface-600'"
                  @click="detailTab = 'responses'"
                >
                  {{ t('dashboard.jobs.detail.tabResponses') }}
                  <span
                    v-if="resolvedCurrentApplication?.responses?.length"
                    class="ml-1 text-xs text-surface-400"
                  >
                    ({{ resolvedCurrentApplication.responses.length }})
                  </span>
                </button>
                <button
                  class="cursor-pointer px-3.5 py-2.5 text-sm font-medium transition-all duration-150 border-b-2 -mb-px flex items-center gap-1.5"
                  :class="detailTab === 'timeline'
                    ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                    : 'border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300 dark:text-surface-400 dark:hover:text-surface-300 dark:hover:border-surface-600'"
                  @click="detailTab = 'timeline'"
                >
                  <History class="size-3.5" />
                  {{ t('dashboard.jobs.detail.tabTimeline') }}
                </button>
                <button
                  class="cursor-pointer px-3.5 py-2.5 text-sm font-medium transition-all duration-150 border-b-2 -mb-px flex items-center gap-1.5"
                  :class="detailTab === 'properties'
                    ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                    : 'border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300 dark:text-surface-400 dark:hover:text-surface-300 dark:hover:border-surface-600'"
                  @click="detailTab = 'properties'"
                >
                  <SlidersHorizontal class="size-3.5" />
                  {{ t('dashboard.jobs.detail.tabProperties') }}
                </button>
              </div>
            </div>

            <!-- Detail content -->
            <div class="bg-surface-50/80 dark:bg-surface-950/80 px-4 sm:px-6 py-5 sm:py-8">
              <div v-if="detailFetchStatus === 'pending' && !resolvedCurrentApplication" class="flex flex-col items-center justify-center py-12">
                <div class="size-8 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin" />
                <p class="mt-3 text-sm text-surface-400">{{ t('dashboard.jobs.detail.loadingDetails') }}</p>
              </div>

              <template v-else>



              <!-- PROFILE SECTION (overview only) -->
              <div v-if="showSection.profile" ref="overviewRef" class="space-y-5 max-w-4xl mx-auto">
                <!-- Collaboration thread (заменяет старые заметки) -->
                <ApplicationCommentThread
                  v-if="currentSummary?.id"
                  :key="currentSummary.id"
                  :application-id="currentSummary.id"
                  :compact="true"
                />

                <!-- Quick links -->
                <div class="flex items-center gap-4 pt-1">
                  <NuxtLink
                    :to="$localePath(`/dashboard/applications/${currentSummary.id}`)"
                    class="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 font-medium transition-colors group"
                  >
                    <ExternalLink class="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    {{ t('dashboard.jobs.detail.fullApplicationPage') }}
                  </NuxtLink>
                </div>
              </div>

              <!-- AI SCORE BREAKDOWN -->
              <div v-if="showSection.aiAnalysis" class="max-w-4xl mx-auto" :class="detailTab === 'overview' ? 'mt-5' : ''">
                <ScoreBreakdown
                  v-if="currentSummary"
                  :application-id="currentSummary.id"
                  @scored="refreshApps()"
                />
              </div>

              <!-- INTERVIEWS SECTION -->
              <div v-if="showSection.interviews" ref="interviewsRef" class="space-y-3 max-w-4xl mx-auto" :class="detailTab === 'overview' ? 'mt-10' : ''">
                <div class="flex items-center justify-between mb-3">
                  <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2">
                    <Calendar class="size-4 text-surface-400 dark:text-surface-500" />
                    {{ t('dashboard.jobs.detail.tabInterviews') }}
                  </h2>
                  <button
                    class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700/80 px-2.5 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-white hover:border-surface-300 dark:hover:bg-surface-800 dark:hover:border-surface-600 transition-all duration-150"
                    @click="openInterviewScheduler"
                  >
                    <Plus class="size-3.5" />
                    {{ t('dashboard.jobs.detail.scheduleInterview') }}
                  </button>
                </div>

                <div v-if="currentApplicationInterviews.length > 0" class="space-y-3">
                  <div
                    v-for="iv in currentApplicationInterviews"
                    :key="iv.id"
                    class="rounded-xl border bg-white shadow-sm shadow-surface-900/[0.03] dark:bg-surface-900 dark:shadow-none transition-all duration-200"
                    :class="expandedInterviewId === iv.id
                      ? 'border-brand-300 dark:border-brand-700 shadow-md'
                      : 'border-surface-200/80 dark:border-surface-800/60 hover:border-surface-300 dark:hover:border-surface-700'"
                  >
                    <!-- Interview card header (always visible) -->
                    <button
                      class="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left"
                      @click="toggleInterviewExpand(iv.id)"
                    >
                      <div class="flex items-center gap-3.5 min-w-0">
                        <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-950/40">
                          <component :is="interviewTypeIcons[iv.type] ?? Calendar" class="size-4.5 text-brand-600 dark:text-brand-400" />
                        </div>
                        <div class="min-w-0">
                          <p class="text-sm font-medium text-surface-800 dark:text-surface-100 truncate">
                            {{ iv.title }}
                          </p>
                          <p class="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                            <TimelineDateLink :date="iv.scheduledAt">{{ formatInterviewDateTime(iv.scheduledAt) }}</TimelineDateLink> · {{ iv.duration }} min · {{ interviewTypeLabels[iv.type] ?? iv.type }}
                          </p>
                          <div v-if="iv.googleCalendarEventId" class="mt-1">
                            <a
                              v-if="iv.googleCalendarEventLink"
                              :href="iv.googleCalendarEventLink"
                              target="_blank"
                              rel="noopener noreferrer"
                              class="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors"
                              @click.stop
                            >
                              <Calendar class="size-2.5" />
                              Google Calendar
                              <ExternalLink class="size-2" />
                            </a>
                            <span v-else class="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                              <Calendar class="size-2.5" />
                              Google Calendar
                            </span>
                          </div>
                        </div>
                      </div>
                      <div class="flex items-center gap-2.5 shrink-0">
                        <span
                          class="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset"
                          :class="interviewStatusClasses[iv.status] ?? 'bg-surface-100 text-surface-500 ring-surface-200'"
                        >
                          <component :is="interviewStatusIcons[iv.status as InterviewStatus] ?? Calendar" class="size-3" />
                          {{ iv.status === 'no_show' ? t('dashboard.jobs.detail.interviewNoShow') : iv.status }}
                        </span>
                        <ChevronDown
                          class="size-4 text-surface-400 transition-transform duration-200"
                          :class="{ 'rotate-180': expandedInterviewId === iv.id }"
                        />
                      </div>
                    </button>

                    <!-- Expanded interview detail -->
                    <div v-if="expandedInterviewId === iv.id" class="border-t border-surface-200/80 dark:border-surface-800/60">
                      <!-- Status transition buttons -->
                      <div v-if="getAllowedInterviewTransitions(iv.status).length > 0" class="px-5 pt-4 pb-2">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mr-1">{{ t('dashboard.jobs.detail.actions') }}:</span>
                          <button
                            v-for="nextStatus in getAllowedInterviewTransitions(iv.status)"
                            :key="nextStatus"
                            :disabled="isInterviewTransitioning"
                            class="cursor-pointer rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                            :class="interviewTransitionClasses[nextStatus]"
                            @click.stop="nextStatus === 'scheduled' ? openReschedule(iv) : handleInterviewTransition(iv.id, nextStatus)"
                          >
                            {{ interviewTransitionLabels[nextStatus] }}
                          </button>
                        </div>
                      </div>

                      <!-- Reschedule form (inline) -->
                      <div v-if="rescheduleInterviewId === iv.id" class="px-5 py-4 border-t border-surface-100 dark:border-surface-800/60">
                        <h4 class="text-xs font-semibold text-surface-700 dark:text-surface-300 mb-3 flex items-center gap-1.5">
                          <Calendar class="size-3.5" />
                          {{ t('dashboard.jobs.detail.interviewReschedule') }}
                        </h4>
                        <div class="grid grid-cols-3 gap-3">
                          <div>
                            <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">{{ t('dashboard.jobs.detail.date') }}</label>
                            <input
                              v-model="rescheduleForm.date"
                              type="date"
                              class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                              @click.stop
                            />
                          </div>
                          <div>
                            <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">{{ t('dashboard.jobs.detail.time') }}</label>
                            <input
                              v-model="rescheduleForm.time"
                              type="time"
                              class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                              @click.stop
                            />
                          </div>
                          <div>
                            <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">{{ t('dashboard.jobs.detail.duration') }}</label>
                            <input
                              v-model.number="rescheduleForm.duration"
                              type="number"
                              min="5"
                              max="480"
                              class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                              @click.stop
                            />
                          </div>
                        </div>
                        <p v-if="rescheduleError" class="mt-2 text-xs text-danger-600 dark:text-danger-400">{{ rescheduleError }}</p>
                        <div class="flex items-center justify-end gap-2 mt-3">
                          <button
                            class="cursor-pointer rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                            @click.stop="cancelReschedule"
                          >
                            {{ t('dashboard.jobs.detail.cancel') }}
                          </button>
                          <button
                            :disabled="isRescheduling"
                            class="cursor-pointer rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            @click.stop="handleReschedule"
                          >
                            {{ isRescheduling ? t('dashboard.jobs.detail.saving') : t('dashboard.jobs.detail.interviewReschedule') }}
                          </button>
                        </div>
                      </div>

                      <!-- Interview details / edit form -->
                      <div class="px-5 py-4">
                        <!-- View mode -->
                        <template v-if="editingInterviewId !== iv.id">
                          <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                            <div>
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">{{ t('dashboard.jobs.detail.dateAndTime') }}</dt>
                              <dd class="text-surface-800 dark:text-surface-200 font-medium text-[13px]">
                                <TimelineDateLink :date="iv.scheduledAt">{{ formatInterviewDateTimeFull(iv.scheduledAt) }}</TimelineDateLink>
                              </dd>
                            </div>
                            <div>
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">{{ t('dashboard.jobs.detail.durationLabel') }}</dt>
                              <dd class="text-surface-800 dark:text-surface-200 font-medium text-[13px] flex items-center gap-1.5">
                                <Clock class="size-3.5 text-surface-400" />
                                {{ iv.duration }} {{ t('dashboard.jobs.detail.minutes') }}
                              </dd>
                            </div>
                            <div>
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">{{ t('dashboard.jobs.detail.type') }}</dt>
                              <dd class="text-surface-800 dark:text-surface-200 font-medium text-[13px] flex items-center gap-1.5">
                                <component :is="interviewTypeIcons[iv.type] ?? Calendar" class="size-3.5 text-surface-400" />
                                {{ interviewTypeLabels[iv.type] ?? iv.type }}
                              </dd>
                            </div>
                            <div v-if="iv.location">
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">{{ t('dashboard.jobs.detail.location') }}</dt>
                              <dd class="text-surface-800 dark:text-surface-200 font-medium text-[13px] flex items-center gap-1.5">
                                <MapPin class="size-3.5 text-surface-400" />
                                {{ iv.location }}
                              </dd>
                            </div>
                            <div v-if="iv.interviewers?.length" class="col-span-2">
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">{{ t('dashboard.jobs.detail.interviewers') }}</dt>
                              <dd class="text-surface-800 dark:text-surface-200 font-medium text-[13px] flex items-center gap-1.5">
                                <Users class="size-3.5 text-surface-400" />
                                {{ iv.interviewers.join(', ') }}
                              </dd>
                            </div>
                            <div v-if="iv.notes" class="col-span-2">
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">{{ t('dashboard.jobs.detail.notesLabel') }}</dt>
                              <dd class="text-surface-700 dark:text-surface-300 text-[13px] leading-relaxed whitespace-pre-wrap">
                                {{ iv.notes }}
                              </dd>
                            </div>
                            <div v-if="iv.googleCalendarEventId" class="col-span-2">
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">{{ t('dashboard.jobs.detail.calendarSync') }}</dt>
                              <dd class="text-[13px]">
                                <a
                                  v-if="iv.googleCalendarEventLink"
                                  :href="iv.googleCalendarEventLink"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 text-emerald-700 dark:text-emerald-400 font-medium hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors"
                                >
                                  <Calendar class="size-3.5" />
                                  {{ t('dashboard.jobs.detail.openInGoogleCalendar') }}
                                  <ExternalLink class="size-3" />
                                </a>
                                <span v-else class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 text-emerald-700 dark:text-emerald-400 font-medium">
                                  <Calendar class="size-3.5" />
                                  {{ t('dashboard.jobs.detail.syncedToGoogleCalendar') }}
                                </span>
                              </dd>
                            </div>
                          </dl>
                          <div class="flex items-center gap-3 mt-4 pt-3 border-t border-surface-100 dark:border-surface-800/60">
                            <button
                              class="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
                              @click.stop="startInterviewEdit(iv)"
                            >
                              <Pencil class="size-3" />
                              {{ t('dashboard.jobs.detail.editDetails') }}
                            </button>
                            <NuxtLink
                              :to="$localePath(`/dashboard/interviews/${iv.id}`)"
                              class="inline-flex items-center gap-1.5 text-xs font-medium text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300 transition-colors"
                              @click.stop
                            >
                              <ExternalLink class="size-3" />
                              {{ t('dashboard.jobs.detail.fullPage') }}
                            </NuxtLink>
                          </div>
                        </template>

                        <!-- Edit mode -->
                        <template v-else>
                          <div class="space-y-3">
                            <div>
                              <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">{{ t('dashboard.jobs.detail.titleLabel') }}</label>
                              <input
                                v-model="interviewEditForm.title"
                                type="text"
                                class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
                                :class="interviewEditErrors.title ? 'border-danger-300 dark:border-danger-600' : 'border-surface-200 dark:border-surface-700'"
                                @click.stop
                              />
                              <p v-if="interviewEditErrors.title" class="mt-1 text-[11px] text-danger-600 dark:text-danger-400">{{ interviewEditErrors.title }}</p>
                            </div>

                            <div>
                              <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">{{ t('dashboard.jobs.detail.type') }}</label>
                              <select
                                v-model="interviewEditForm.type"
                                class="w-full rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
                                @click.stop
                              >
                                <option value="video">{{ t('dashboard.jobs.detail.typeVideo') }}</option>
                                <option value="phone">{{ t('dashboard.jobs.detail.typePhone') }}</option>
                                <option value="in_person">{{ t('dashboard.jobs.detail.typeInPerson') }}</option>
                                <option value="technical">{{ t('dashboard.jobs.detail.typeTechnical') }}</option>
                                <option value="panel">{{ t('dashboard.jobs.detail.typePanel') }}</option>
                                <option value="take_home">{{ t('dashboard.jobs.detail.typeTakeHome') }}</option>
                              </select>
                            </div>

                            <div>
                              <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">{{ t('dashboard.jobs.detail.locationLink') }}</label>
                              <input
                                v-model="interviewEditForm.location"
                                type="text"
:placeholder="t('dashboard.jobs.detail.locationPlaceholder')"
                                class="w-full rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
                                @click.stop
                              />
                            </div>

                            <div>
                              <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">{{ t('dashboard.jobs.detail.notesLabel') }}</label>
                              <textarea
                                v-model="interviewEditForm.notes"
                                rows="3"
:placeholder="t('dashboard.jobs.detail.interviewNotesPlaceholder')"
                                class="w-full rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
                                @click.stop
                              />
                            </div>

                            <div>
                              <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1.5">{{ t('dashboard.jobs.detail.interviewers') }}</label>
                              <div class="space-y-2">
                                <div v-for="(_, idx) in interviewEditForm.interviewers" :key="idx" class="flex items-center gap-2">
                                  <input
                                    v-model="interviewEditForm.interviewers[idx]"
                                    type="text"
:placeholder="t('dashboard.jobs.detail.nameOrEmail')"
                                    class="flex-1 rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-1.5 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
                                    @click.stop
                                  />
                                  <button
                                    v-if="interviewEditForm.interviewers.length > 1"
                                    class="cursor-pointer rounded-md p-1 text-surface-400 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-950/40 transition-colors"
                                    @click.stop="removeEditInterviewer(idx)"
                                  >
                                    <X class="size-3.5" />
                                  </button>
                                </div>
                              </div>
                              <button
                                class="mt-2 inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
                                @click.stop="addEditInterviewer"
                              >
                                <Plus class="size-3" />
                                {{ t('dashboard.jobs.detail.addInterviewer') }}
                              </button>
                            </div>

                            <p v-if="interviewEditErrors.submit" class="text-xs text-danger-600 dark:text-danger-400">{{ interviewEditErrors.submit }}</p>

                            <div class="flex items-center justify-end gap-2 pt-2">
                              <button
                                class="cursor-pointer rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                                @click.stop="cancelInterviewEdit"
                              >
                                {{ t('dashboard.jobs.detail.cancel') }}
                              </button>
                              <button
                                :disabled="isInterviewSaving"
                                class="cursor-pointer rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                @click.stop="saveInterviewEdit"
                              >
                                {{ isInterviewSaving ? t('dashboard.jobs.detail.saving') : t('dashboard.jobs.detail.saveChanges') }}
                              </button>
                            </div>
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Empty state -->
                <div v-else class="rounded-xl border border-surface-200/80 bg-white p-10 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
                  <div class="flex size-14 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                    <Calendar class="size-6 text-surface-400 dark:text-surface-500" />
                  </div>
                  <p class="text-sm font-medium text-surface-600 dark:text-surface-300">{{ t('dashboard.jobs.detail.noInterviews') }}</p>
                  <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.detail.scheduleInterviewHint') }}</p>
                  <button
                    class="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-700 transition-colors shadow-sm"
                    @click="openInterviewScheduler"
                  >
                    <Plus class="size-3.5" />
                    {{ t('dashboard.jobs.detail.scheduleInterview') }}
                  </button>
                </div>
              </div>

              <!-- DOCUMENTS SECTION -->
              <div v-if="showSection.documents" ref="documentsRef" class="space-y-3 max-w-4xl mx-auto" :class="detailTab === 'overview' ? 'mt-10' : ''">
                <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2 mb-3">
                  <Paperclip class="size-4 text-surface-400 dark:text-surface-500" />
                  {{ t('dashboard.jobs.detail.tabDocuments') }}
                </h2>
                <div v-if="resolvedCurrentApplication?.candidate.documents?.length" class="space-y-3">
                  <div
                    v-for="doc in resolvedCurrentApplication.candidate.documents"
                    :key="doc.id"
                    class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-200/80 bg-white px-5 py-4 shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none transition-colors hover:border-surface-300 dark:hover:border-surface-700"
                  >
                    <div class="flex items-center gap-3.5 min-w-0">
                      <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800/60">
                        <FileText class="size-4.5 text-surface-500 dark:text-surface-400" />
                      </div>
                      <div class="min-w-0">
                        <p class="text-sm font-medium text-surface-800 dark:text-surface-100 truncate">
                          {{ doc.originalFilename }}
                        </p>
                        <p class="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                          {{ formatDocumentType(doc.type) }} · <TimelineDateLink :date="doc.createdAt">{{ new Date(doc.createdAt).toLocaleDateString() }}</TimelineDateLink>
                        </p>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <button
                        class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50 hover:border-surface-300 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800 dark:hover:border-surface-600 transition-all duration-150"
                        @click="handleDocPreview(doc)"
                      >
                        <Eye class="size-3.5" />
                        {{ t('dashboard.jobs.detail.preview') }}
                      </button>
                      <a
                        :href="`/api/documents/${doc.id}/download`"
                        class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50 hover:border-surface-300 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800 dark:hover:border-surface-600 transition-all duration-150"
                      >
                        <Download class="size-3.5" />
                        {{ t('dashboard.jobs.detail.download') }}
                      </a>
                    </div>
                  </div>
                </div>
                <div v-else class="rounded-xl border border-surface-200/80 bg-white p-10 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
                  <div class="flex size-14 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                    <FileText class="size-6 text-surface-400 dark:text-surface-500" />
                  </div>
                  <p class="text-sm font-medium text-surface-600 dark:text-surface-300">{{ t('dashboard.jobs.detail.noDocuments') }}</p>
                  <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.detail.noDocumentsHint') }}</p>
                </div>
              </div>

              <!-- RESPONSES SECTION -->
              <div v-if="showSection.responses" ref="responsesRef" class="space-y-3 max-w-4xl mx-auto" :class="detailTab === 'overview' ? 'mt-10' : ''">
                <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2 mb-3">
                  <MessageSquare class="size-4 text-surface-400 dark:text-surface-500" />
                  {{ t('dashboard.jobs.detail.tabResponses') }}
                </h2>                <template v-if="resolvedCurrentApplication?.responses?.length">
                  <div class="space-y-3">
                    <div
                      v-for="response in resolvedCurrentApplication.responses"
                      :key="response.id"
                      class="rounded-xl border border-surface-200/80 bg-white p-5 shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none"
                    >
                      <p class="text-xs font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mb-2">
                        {{ response.question?.label ?? t('dashboard.jobs.detail.unknownQuestion') }}
                      </p>
                      <p class="text-sm text-surface-700 dark:text-surface-200 leading-relaxed">
                        {{ formatResponseValue(response.value) }}
                      </p>
                    </div>
                  </div>
                </template>
                <div v-else class="rounded-xl border border-surface-200/80 bg-white p-10 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
                  <div class="flex size-14 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                    <MessageSquare class="size-6 text-surface-400 dark:text-surface-500" />
                  </div>
                  <p class="text-sm font-medium text-surface-600 dark:text-surface-300">{{ t('dashboard.jobs.detail.noResponses') }}</p>
                  <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.detail.noResponsesHint') }}</p>
                </div>
              </div>

              <!-- PROPERTIES SECTION -->
              <div v-if="showSection.properties && resolvedCurrentApplication" class="max-w-4xl mx-auto" :class="detailTab === 'overview' ? 'mt-10' : ''">
                <div class="rounded-xl border border-surface-200/80 bg-white p-5 shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
                  <div class="flex items-center gap-2.5 mb-4">
                    <div class="flex size-7 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-950/40">
                      <SlidersHorizontal class="size-3.5 text-brand-600 dark:text-brand-400" />
                    </div>
                    <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ t('dashboard.jobs.detail.tabProperties') }}</h3>
                  </div>
                  <PropertyBlock
                    entity-type="application"
                    :entity-id="resolvedCurrentApplication.id"
                    :job-id="jobId"
                    :entries="resolvedCurrentApplication.properties ?? []"
                    @refresh="executeDetailFetch(); refreshApps()"
                  />
                </div>
              </div>

              <!-- TIMELINE SECTION -->
              <div v-if="showSection.timeline" class="space-y-3 max-w-4xl mx-auto">
                <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2 mb-3">
                  <History class="size-4 text-surface-400 dark:text-surface-500" />
                  {{ t('dashboard.jobs.detail.tabTimeline') }}
                </h2>

                <!-- Loading -->
                <div v-if="timelineLoading" class="text-center py-12 text-surface-400">
                  <div class="size-6 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin mx-auto mb-3" />
                  {{ t('dashboard.jobs.detail.loadingTimeline') }}
                </div>

                <!-- Error -->
                <div
                  v-else-if="timelineError"
                  class="rounded-xl border border-danger-200/80 dark:border-danger-800/60 bg-danger-50 dark:bg-danger-950/40 p-5 text-center"
                >
                  <AlertTriangle class="size-6 text-danger-400 mx-auto mb-2" />
                  <p class="text-sm text-danger-700 dark:text-danger-400">{{ timelineError }}</p>
                  <button
                    class="mt-3 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium cursor-pointer"
                    @click="loadTimeline"
                  >
                    {{ t('dashboard.jobs.detail.retry') }}
                  </button>
                </div>

                <!-- Empty -->
                <div
                  v-else-if="timelineItems.length === 0"
                  class="rounded-xl border border-surface-200/80 bg-white p-10 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none"
                >
                  <div class="flex size-14 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                    <History class="size-6 text-surface-400 dark:text-surface-500" />
                  </div>
                  <p class="text-sm font-medium text-surface-600 dark:text-surface-300">{{ t('dashboard.jobs.detail.noActivity') }}</p>
                  <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.detail.noActivityHint') }}</p>
                </div>

                <!-- Timeline list -->
                <div v-else>
                  <div
                    v-for="(item, index) in timelineItems"
                    :key="item.id"
                    class="group flex items-start gap-3 py-1.5 px-1 transition-colors duration-150 hover:bg-surface-50 dark:hover:bg-surface-800/40 rounded-lg"
                  >
                    <!-- Left column: icon + connector -->
                    <div class="flex flex-col items-center shrink-0">
                      <div class="flex items-center justify-center size-6 rounded shrink-0" :class="getTimelineActionStyle(item.action).bg">
                        <component :is="getTimelineActionStyle(item.action).icon" class="size-3" :class="getTimelineActionStyle(item.action).color" />
                      </div>
                      <div
                        v-if="index < timelineItems.length - 1"
                        class="w-px flex-1 min-h-[10px] bg-surface-200 dark:bg-surface-800 mt-0.5"
                      />
                    </div>

                      <!-- Content -->
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <span class="text-[13px] font-medium text-surface-900 dark:text-surface-100 shrink-0">{{ timelineActionLabels[item.action] ?? item.action }}</span>
                          <span class="text-[13px] text-surface-500 dark:text-surface-400">{{ item.resourceType }}</span>
                          <template v-if="item.action === 'status_changed' && item.metadata">
                            <span v-if="item.metadata.from_status || item.metadata.fromStatus" class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none" :class="getTimelineStatusBadge(String(item.metadata.from_status ?? item.metadata.fromStatus))">{{ formatStatusLabel(String(item.metadata.from_status ?? item.metadata.fromStatus)) }}</span>
                            <ArrowRight class="size-2.5 text-surface-400 dark:text-surface-500 shrink-0" />
                            <span v-if="item.metadata.to_status || item.metadata.toStatus" class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none" :class="getTimelineStatusBadge(String(item.metadata.to_status ?? item.metadata.toStatus))">{{ formatStatusLabel(String(item.metadata.to_status ?? item.metadata.toStatus)) }}</span>
                          </template>
                          <template v-else-if="item.action === 'scored' && item.metadata?.score">
                            <span class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none bg-accent-100 text-accent-700 dark:bg-accent-900/60 dark:text-accent-300">{{ item.metadata.score }} {{ t('common.points') }}</span>
                          </template>
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                          <span v-if="item.actorName || item.actorEmail" class="text-[11px] text-surface-400 dark:text-surface-500">{{ item.actorName ?? item.actorEmail }}</span>
                          <span class="text-[11px] text-surface-400 dark:text-surface-500 tabular-nums">{{ formatTimelineDate(item.createdAt) }}</span>
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
            </div>
          </template>
        </div>


      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- MOBILE BOTTOM CANDIDATE BAR              -->
      <!-- ═══════════════════════════════════════ -->
      <div
        v-if="filteredApplications.length > 0"
        class="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-surface-200/80 bg-white dark:border-surface-800/60 dark:bg-surface-900"
        :style="{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }"
      >
        <!-- Horizontal scrollable candidate cards -->
        <div
          ref="mobileBottomBar"
          class="flex items-stretch gap-2 overflow-x-auto snap-x snap-mandatory px-3 py-2.5 scrollbar-thin"
        >
          <button
            v-for="(app, idx) in filteredApplications"
            :key="app.id"
            :data-candidate-idx="idx"
            class="snap-center shrink-0 flex items-center gap-2.5 rounded-xl px-3 py-2 min-w-[130px] max-w-[180px] transition-all duration-150 cursor-pointer"
            :class="currentIndex === idx
              ? 'bg-brand-50 ring-2 ring-brand-500 shadow-sm dark:bg-brand-950/30 dark:ring-brand-400'
              : 'bg-surface-50 ring-1 ring-surface-200 hover:ring-surface-300 dark:bg-surface-800/60 dark:ring-surface-700 dark:hover:ring-surface-600'"
            @click="currentIndex = idx"
          >
            <div
              class="flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors duration-150"
              :class="currentIndex === idx
                ? 'bg-brand-500 text-white dark:bg-brand-600'
                : 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-300'"
            >
              {{ getCandidateInitials(app.candidateFirstName, app.candidateLastName) }}
            </div>
            <div class="min-w-0 text-left">
              <p class="text-xs font-medium text-surface-800 dark:text-surface-100 truncate">
                {{ app.candidateFirstName }}
              </p>
              <div class="flex items-center gap-1 mt-0.5">
                <span
                  v-if="app.score != null"
                  class="text-[10px] font-semibold"
                  :class="{
                    'text-success-600 dark:text-success-400': app.score >= 75,
                    'text-warning-600 dark:text-warning-400': app.score >= 40 && app.score < 75,
                    'text-danger-600 dark:text-danger-400': app.score < 40,
                  }"
                >
                  {{ app.score }} {{ t('common.points') }}
                </span>
                <span class="text-[10px] text-surface-400 dark:text-surface-500">{{ timeAgo(app.createdAt) }}</span>
              </div>
            </div>
          </button>
        </div>
        <!-- Position indicator -->
        <div class="flex items-center justify-center pb-1.5">
          <span class="text-[10px] font-medium text-surface-400 dark:text-surface-500 tabular-nums">
            {{ currentIndex + 1 }} / {{ filteredApplications.length }}
          </span>
        </div>
      </div>

      <!-- Mobile empty state for bottom bar -->
      <div
        v-else-if="focusedApplications.length === 0"
        class="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-surface-200/80 bg-white dark:border-surface-800/60 dark:bg-surface-900 px-4 py-3 text-center"
        :style="{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }"
      >
        <p class="text-xs text-surface-400 dark:text-surface-500">
          {{ t('dashboard.jobs.detail.noCandidatesIn', { stage: formatStatusLabel(focusStatus) }) }}
        </p>
      </div>
    </template>

    <!-- ═══════════════════════════════════════ -->
    <!-- MODALS                                   -->
    <!-- ═══════════════════════════════════════ -->

    <!-- Candidate Detail Drawer -->
    <CandidateDetailDrawer
      v-if="showCandidateDrawer && resolvedCurrentApplication?.candidate?.id"
      :candidate-id="resolvedCurrentApplication.candidate.id"
      @close="showCandidateDrawer = false"
    />

    <!-- Interview Schedule Sidebar -->
    <InterviewScheduleSidebar
      v-if="showInterviewSidebar && interviewTargetApplication"
      :application-id="interviewTargetApplication.id"
      :candidate-name="interviewTargetApplication.name"
      :job-title="jobData?.title ?? ''"
      :teleport-target="teleportTarget"
      @close="showInterviewSidebar = false"
      @scheduled="handleInterviewScheduled"
    />

    <!-- Document Preview Modal -->
    <Teleport :to="teleportTarget">
      <div v-if="showDocPreview" class="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeDocPreview" />
        <div class="relative flex flex-col bg-white dark:bg-surface-900 rounded-2xl shadow-2xl shadow-surface-900/10 dark:shadow-black/30 ring-1 ring-surface-200/80 dark:ring-surface-700/60 w-full max-w-4xl" style="height: calc(100vh - 3rem);">
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-3 border-b border-surface-200/80 dark:border-surface-800/60 shrink-0">
            <div class="flex items-center gap-2.5 min-w-0">
              <FileText class="size-4 text-surface-400 shrink-0" />
              <span class="text-sm font-medium text-surface-800 dark:text-surface-100 truncate">{{ docPreviewFilename }}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0 ml-4">
              <a
                v-if="docPreviewDocId"
                :href="`/api/documents/${docPreviewDocId}/download`"
                class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-2.5 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50 hover:border-surface-300 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800 transition-all duration-150"
              >
                <Download class="size-3.5" />
                {{ t('dashboard.jobs.detail.download') }}
              </a>
              <button
                class="rounded-lg p-1.5 text-surface-500 hover:text-surface-700 hover:bg-surface-100 dark:hover:text-surface-300 dark:hover:bg-surface-800 transition-colors"
                :title="t('dashboard.jobs.detail.close')"
                @click="closeDocPreview"
              >
                <X class="size-4" />
              </button>
            </div>
          </div>
          <!-- PDF viewer -->
          <iframe
            v-if="docPreviewUrl && isDocPreviewPdf"
            :src="docPreviewUrl"
            class="flex-1 w-full rounded-b-2xl min-h-0"
            title="Document preview"
          />
          <!-- Non-PDF fallback -->
          <div v-else class="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <FileText class="size-12 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
              <p class="text-sm font-medium text-surface-600 dark:text-surface-300">{{ t('dashboard.jobs.detail.previewNotAvailable') }}</p>
              <a
                v-if="docPreviewDocId"
                :href="`/api/documents/${docPreviewDocId}/download`"
                class="mt-3 inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium"
              >
                <Download class="size-3.5" />
                {{ t('dashboard.jobs.detail.downloadInstead') }}
              </a>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
