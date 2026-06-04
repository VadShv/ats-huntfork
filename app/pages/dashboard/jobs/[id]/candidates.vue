<script setup lang="ts">
import { Users, SlidersHorizontal, X, Check, ChevronsUpDown, ChevronUp, ChevronDown, UserRound, Sparkles, Loader2, ChevronDown as ChevronDownIcon } from 'lucide-vue-next'

const { t } = useI18n()

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const jobId = route.params.id as string

const { formatPersonName } = useOrgSettings()

// ─────────────────────────────────────────────
// Fetch job info for page header
// ─────────────────────────────────────────────

const { data: jobData, status: jobFetchStatus, error: jobError } = useFetch(
  () => `/api/jobs/${jobId}`,
  {
    key: `candidates-job-${jobId}`,
    headers: useRequestHeaders(['cookie']),
  },
)

useSeoMeta({
  title: computed(() =>
    jobData.value ? `Table — ${jobData.value.title}` : 'Table',
  ),
})

// ─────────────────────────────────────────────
// Fetch applications for this job
// ─────────────────────────────────────────────

const STATUS_OPTIONS = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const
type Status = typeof STATUS_OPTIONS[number]

// useState scoped to this job so state persists across sub-navigation
const selectedStatuses = useState<Status[]>(`cand-filter-statuses-${jobId}`, () => [])
const scoreMin = useState<number | undefined>(`cand-filter-score-min-${jobId}`, () => undefined)
const scoreMax = useState<number | undefined>(`cand-filter-score-max-${jobId}`, () => undefined)
const selectedStageId = useState<string | undefined>(`cand-filter-stageId-${jobId}`, () => undefined)
const visibleCols = useState(`cand-visible-cols-${jobId}`, () => ({
  email: true,
  score: true,
  stage: true,
  status: true,
  createdAt: true,
}))

// ── Pipeline stages for this job (for stage filter) ────────────────────────────

const { data: pipelineStatus } = useFetch(
  () => `/api/jobs/${jobId}/pipeline-status`,
  {
    key: `cand-pipeline-status-${jobId}`,
    headers: useRequestHeaders(['cookie']),
  },
)

const pipelineId = computed(() => pipelineStatus.value?.pipelineId ?? null)
const pipelineName = computed(() => pipelineStatus.value?.pipelineName ?? null)

type StageItem = { id: string; name: string; color: string; type: string; displayOrder: number; isArchived: boolean }

const { data: pipelineData } = useFetch(
  () => pipelineId.value ? `/api/pipelines/${pipelineId.value}` : null,
  {
    key: computed(() => `cand-pipeline-${pipelineId.value}`),
    headers: useRequestHeaders(['cookie']),
    watch: [pipelineId],
  },
)

const pipelineStages = computed<StageItem[]>(() => {
  if (!pipelineData.value) return []
  // The pipeline GET endpoint returns stages in displayOrder
  return ((pipelineData.value as { stages?: StageItem[] }).stages ?? [])
    .filter((s: StageItem) => !s.isArchived)
})

const hasPipeline = computed(() => !!pipelineId.value)

// Only send a single status to the API when exactly one is selected; otherwise fetch all and filter client-side
const apiStatusFilter = computed(() =>
  selectedStatuses.value.length === 1 ? selectedStatuses.value[0] : undefined,
)

const { data: appData, status: appFetchStatus, error: appError, refresh: refreshApps } = useFetch('/api/applications', {
  key: `candidates-table-apps-${jobId}`,
  query: computed(() => ({
    jobId,
    limit: 100,
    ...(apiStatusFilter.value && { status: apiStatusFilter.value }),
    ...(selectedStageId.value && { stageId: selectedStageId.value }),
  })),
  headers: useRequestHeaders(['cookie']),
})

const applications = computed(() => appData.value?.data ?? [])
const total = computed(() => appData.value?.total ?? 0)

// hh.ru связка вакансии — панель «Связано с hh.ru» и кнопка ручного синка
interface HhLinkInfo {
  id: string
  hhVacancyId: string
  hhVacancyUrl: string | null
  hhVacancyTitle: string | null
  lastSyncAt: string | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  importedCount: number
  autoSyncEnabled: boolean
}
const { data: hhLinkData, refresh: refreshHhLink } = useFetch<{ linked: boolean, link?: HhLinkInfo }>(`/api/jobs/${jobId}/hh-link`, {
  key: `hh-link-${jobId}`,
  headers: useRequestHeaders(['cookie']),
  default: () => ({ linked: false }),
})
const hhLink = computed<HhLinkInfo | null>(() => hhLinkData.value?.linked ? (hhLinkData.value.link ?? null) : null)
const isSyncingHh = ref(false)
const hhRelativeTime = computed(() => {
  const at = hhLink.value?.lastSyncAt
  if (!at) return null
  const diff = Date.now() - new Date(at).getTime()
  if (diff < 60_000) return 'только что'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  return `${d} дн. назад`
})

// ──────────────────────────────────────────────
// Batch AI scoring («Обработать всё/выборочно»)
// ──────────────────────────────────────────────
const toast = useToast()
const selectedAppIds = ref<Set<string>>(new Set())
const isBatchScoring = ref(false)
const batchMenuOpen = ref(false)
const batchMenuRef = ref<HTMLElement | null>(null)

function toggleAppSelection(id: string) {
  const next = new Set(selectedAppIds.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  selectedAppIds.value = next
}

function toggleSelectAllVisible() {
  const visible = sorted.value.map(a => a.id)
  const allSelected = visible.every(id => selectedAppIds.value.has(id))
  const next = new Set(selectedAppIds.value)
  if (allSelected) {
    for (const id of visible) next.delete(id)
  } else {
    for (const id of visible) next.add(id)
  }
  selectedAppIds.value = next
}

function clearSelection() {
  selectedAppIds.value = new Set()
}

const unscoredCount = computed(() => applications.value.filter((a: any) => a.score == null).length)
const selectedCount = computed(() => selectedAppIds.value.size)

// Close batch menu on outside click
onMounted(() => {
  const onDocClick = (e: MouseEvent) => {
    if (!batchMenuRef.value) return
    if (!batchMenuRef.value.contains(e.target as Node)) batchMenuOpen.value = false
  }
  document.addEventListener('mousedown', onDocClick)
  onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))
})

async function runBatchScore(mode: 'all' | 'rescore_all' | 'selected') {
  if (isBatchScoring.value) return
  batchMenuOpen.value = false

  const body: Record<string, unknown> = { mode }
  if (mode === 'selected') {
    if (selectedAppIds.value.size === 0) {
      toast.add({ title: 'Ничего не выбрано', description: 'Отметьте отклики в таблице', color: 'warning' })
      return
    }
    body.ids = Array.from(selectedAppIds.value)
  }

  isBatchScoring.value = true
  const startedAt = Date.now()
  try {
    const res = await $fetch<{
      total: number
      succeeded: number
      failed: number
      skipped: number
    }>(`/api/jobs/${jobId}/batch-score`, {
      method: 'POST',
      body,
    })

    const seconds = Math.round((Date.now() - startedAt) / 1000)
    const parts: string[] = []
    if (res.succeeded > 0) parts.push(`обработано ${res.succeeded}`)
    if (res.skipped > 0) parts.push(`пропущено ${res.skipped}`)
    if (res.failed > 0) parts.push(`ошибок ${res.failed}`)

    toast.add({
      title: res.total === 0 ? 'Нечего обрабатывать' : 'Скоринг завершён',
      description: res.total === 0
        ? 'Нет откликов, подходящих под выбранный режим'
        : `${parts.join(', ')} — за ${seconds} сек`,
      color: res.failed > 0 ? 'warning' : 'success',
    })

    clearSelection()
    await refreshApps()
  }
  catch (err: any) {
    const msg = err?.data?.statusMessage || err?.statusMessage || err?.message || 'Не удалось запустить скоринг'
    toast.add({ title: 'Ошибка', description: msg, color: 'error' })
  }
  finally {
    isBatchScoring.value = false
  }
}

// Ручной синк откликов с hh.ru по этой вакансии (тянет по всем коллекциям)
async function runHhSync() {
  const link = hhLink.value
  if (!link || isSyncingHh.value) return
  isSyncingHh.value = true
  try {
    const res = await $fetch<{ fetched: number, created: number, updated: number, failed: number, error?: string }>(`/api/hh/sync/${link.id}`, { method: 'POST' })
    if (res.error) {
      toast.add({ title: 'Ошибка синхронизации hh.ru', description: res.error, color: 'error' })
    }
    else {
      toast.add({
        title: 'Синхронизация hh.ru',
        description: `Получено: ${res.fetched} · новых: ${res.created} · обновлено: ${res.updated}${res.failed ? ` · ошибок: ${res.failed}` : ''}`,
        color: res.created > 0 || res.updated > 0 ? 'success' : 'info',
      })
    }
    await Promise.all([refreshHhLink(), refreshApps()])
  }
  catch (err: any) {
    const msg = err?.data?.statusMessage || err?.statusMessage || err?.message || 'Не удалось запустить синхронизацию'
    toast.add({ title: 'Ошибка', description: msg, color: 'error' })
  }
  finally {
    isSyncingHh.value = false
  }
}

// ─────────────────────────────────────────────
// Status & badge helpers
// ─────────────────────────────────────────────

const statusBadgeClasses: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:ring-blue-800',
  screening: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-400 dark:ring-violet-800',
  interview: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:ring-amber-800',
  offer: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/50 dark:text-teal-400 dark:ring-teal-800',
  hired: 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-950/50 dark:text-green-400 dark:ring-green-800',
  rejected: 'bg-surface-100 text-surface-500 ring-surface-200 dark:bg-surface-800/50 dark:text-surface-400 dark:ring-surface-700',
}

function getCandidateInitials(firstName?: string, lastName?: string) {
  const first = firstName?.trim().charAt(0) ?? ''
  const last = lastName?.trim().charAt(0) ?? ''
  return `${first}${last}`.toUpperCase() || 'C'
}

const statusLabels = computed<Record<Status, string>>(() => ({
  new: t('dashboard.jobs.candidates.statusNew'),
  screening: t('dashboard.jobs.candidates.statusScreening'),
  interview: t('dashboard.jobs.candidates.statusInterview'),
  offer: t('dashboard.jobs.candidates.statusOffer'),
  hired: t('dashboard.jobs.candidates.statusHired'),
  rejected: t('dashboard.jobs.candidates.statusRejected'),
}))

function toggleStatus(s: Status) {
  if (selectedStatuses.value.includes(s)) {
    selectedStatuses.value = selectedStatuses.value.filter(x => x !== s)
  }
  else {
    selectedStatuses.value = [...selectedStatuses.value, s]
  }
}

// ─────────────────────────────────────────────
// Column picker panel
// ─────────────────────────────────────────────

const panelOpen = ref(false)
const panelRef = ref<HTMLElement | null>(null)

function handleOutsideClick(e: MouseEvent) {
  if (panelRef.value && !panelRef.value.contains(e.target as Node)) {
    panelOpen.value = false
  }
}
onMounted(() => document.addEventListener('mousedown', handleOutsideClick))
onUnmounted(() => document.removeEventListener('mousedown', handleOutsideClick))

const activeFilterCount = computed(() => {
  let n = selectedStatuses.value.length
  if (scoreMin.value != null) n++
  if (scoreMax.value != null) n++
  if (selectedStageId.value != null) n++
  return n
})

function clearFilters() {
  selectedStatuses.value = []
  scoreMin.value = undefined
  scoreMax.value = undefined
  selectedStageId.value = undefined
}

// ─────────────────────────────────────────────
// Sorting
// ─────────────────────────────────────────────

type SortKey = 'name' | 'email' | 'score' | 'status' | 'createdAt'
type SortDir = 'asc' | 'desc'

const sortKey = useState<SortKey>(`cand-sort-key-${jobId}`, () => 'score')
const sortDir = useState<SortDir>(`cand-sort-dir-${jobId}`, () => 'desc')

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  }
  else {
    sortKey.value = key
    sortDir.value = key === 'score' ? 'desc' : 'asc'
  }
}

// ─────────────────────────────────────────────
// Filtered + sorted list
// ─────────────────────────────────────────────

const sorted = computed(() => {
  return [...applications.value]
    .filter((app) => {
      if (selectedStatuses.value.length > 1 && !selectedStatuses.value.includes(app.status as Status)) return false
      if (scoreMin.value != null && (app.score ?? 0) < scoreMin.value) return false
      if (scoreMax.value != null && (app.score ?? 0) > scoreMax.value) return false
      return true
    })
    .sort((a, b) => {
      let cmp = 0
      switch (sortKey.value) {
        case 'name':
          cmp = `${a.candidateFirstName} ${a.candidateLastName}`.localeCompare(`${b.candidateFirstName} ${b.candidateLastName}`)
          break
        case 'email':
          cmp = (a.candidateEmail ?? '').localeCompare(b.candidateEmail ?? '')
          break
        case 'score':
          cmp = (a.score ?? -1) - (b.score ?? -1)
          break
        case 'status':
          cmp = a.status.localeCompare(b.status)
          break
        case 'createdAt':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
      }
      return sortDir.value === 'asc' ? cmp : -cmp
    })
})

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function timeAgo(date: string | Date) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(date).toLocaleDateString()
}

function scoreClass(score: number) {
  if (score >= 75) return 'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950/60 dark:text-success-400 dark:ring-success-800'
  if (score >= 40) return 'bg-warning-50 text-warning-700 ring-warning-200 dark:bg-warning-950/60 dark:text-warning-400 dark:ring-warning-800'
  return 'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-950/60 dark:text-danger-400 dark:ring-danger-800'
}

// ─────────────────────────────────────────────
// Row selection → sidebar
// ─────────────────────────────────────────────

const selectedAppId = ref<string | null>(null)
const sidebarOpen = computed(() => Boolean(selectedAppId.value))

function selectRow(appId: string) {
  selectedAppId.value = appId
}

function closeSidebar() {
  selectedAppId.value = null
}

async function handleSidebarUpdated() {
  await refreshApps()
}

// ─────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────

const isLoading = computed(() => jobFetchStatus.value === 'pending' || appFetchStatus.value === 'pending')
</script>

<template>
  <div>
    <JobSubNavActions :job-id="jobId" />

    <!-- Loading skeleton -->
    <div v-if="isLoading" class="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-800">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-800">
            <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">{{ $t('dashboard.candidates.table.name') }}</th>
            <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden md:table-cell">Email</th>
            <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">{{ $t('applications.stage.label') }}</th>
            <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
          <SkeletonRow v-for="i in 6" :key="i" :avatar="false" :columns="4" />
        </tbody>
      </table>
    </div>

    <!-- Error -->
    <div
      v-else-if="jobError || appError"
      class="rounded-xl border border-danger-200/80 bg-danger-50 p-5 text-sm text-danger-700 dark:border-danger-800/60 dark:bg-danger-950/40 dark:text-danger-300"
    >
      {{ jobError ? $t('dashboard.jobs.candidates.jobNotFound') : $t('dashboard.jobs.candidates.failedToLoad') }}
      <NuxtLink :to="$localePath('/dashboard')" class="ml-1 font-medium underline hover:no-underline">{{ $t('dashboard.jobs.candidates.backToJobs') }}</NuxtLink>
    </div>

    <template v-else-if="jobData">
      <!-- hh.ru связка вакансии -->
      <div
        v-if="hhLink"
        class="mb-4 flex flex-col gap-3 rounded-xl border border-red-200/80 bg-gradient-to-br from-red-50/70 to-orange-50/50 px-4 py-3 dark:border-red-900/40 dark:from-red-950/20 dark:to-orange-950/10 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-start gap-3 min-w-0">
          <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-bold text-xs">
            hh
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">Связано с hh.ru · #{{ hhLink.hhVacancyId }}</span>
              <span
                v-if="hhLink.lastSyncStatus === 'error'"
                class="inline-flex items-center rounded-full bg-danger-100 dark:bg-danger-950/50 px-2 py-0.5 text-[11px] font-medium text-danger-700 dark:text-danger-300"
                :title="hhLink.lastSyncError ?? ''"
              >Ошибка синка</span>
              <span
                v-else-if="hhLink.lastSyncStatus === 'ok'"
                class="inline-flex items-center rounded-full bg-success-100 dark:bg-success-950/50 px-2 py-0.5 text-[11px] font-medium text-success-700 dark:text-success-300"
              >OK</span>
            </div>
            <div class="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
              <span>{{ hhLink.importedCount }} откликов импортировано</span>
              <span v-if="hhRelativeTime" class="mx-1.5 text-surface-300 dark:text-surface-700">·</span>
              <span v-if="hhRelativeTime">синк {{ hhRelativeTime }}</span>
              <span v-if="!hhLink.autoSyncEnabled" class="mx-1.5 text-surface-300 dark:text-surface-700">·</span>
              <span v-if="!hhLink.autoSyncEnabled" class="text-warn-700 dark:text-warn-400">автосинк выключен</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <a
            v-if="hhLink.hhVacancyUrl"
            :href="hhLink.hhVacancyUrl"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          >Открыть на hh.ru</a>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            :disabled="isSyncingHh"
            @click="runHhSync"
          >
            <Loader2 v-if="isSyncingHh" class="size-3.5 animate-spin" />
            <span>{{ isSyncingHh ? 'Синхронизируем…' : 'Синхронизировать сейчас' }}</span>
          </button>
        </div>
      </div>

      <!-- Toolbar -->
      <div class="flex items-center gap-3 mb-4">
        <!-- Column / filter picker -->
        <div ref="panelRef" class="relative">
          <button
            class="inline-flex items-center gap-2 rounded-lg border border-surface-200 dark:border-surface-700/80 bg-white dark:bg-surface-900 px-3 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 hover:border-surface-300 dark:hover:bg-surface-800 dark:hover:border-surface-600 transition-all duration-150 shadow-sm"
            @click="panelOpen = !panelOpen"
          >
            <SlidersHorizontal class="size-4" />
            View
            <span
              v-if="activeFilterCount > 0"
              class="inline-flex items-center justify-center size-4 rounded-full bg-brand-500 text-white text-[10px] font-semibold"
            >
              {{ activeFilterCount }}
            </span>
          </button>

          <!-- Dropdown panel -->
          <div
            v-if="panelOpen"
            class="absolute left-0 top-full mt-2 z-20 w-72 rounded-xl border border-surface-200/80 dark:border-surface-700/80 bg-white dark:bg-surface-900 shadow-xl shadow-surface-900/5 dark:shadow-black/20 p-4 space-y-5"
          >
            <!-- Columns -->
            <div>
              <p class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-2">{{ $t('dashboard.jobs.candidates.columns') }}</p>
              <div class="space-y-1.5">
                <label
                  v-for="col in ([
                    { key: 'email', label: $t('dashboard.jobs.candidates.colEmail') },
                    { key: 'score', label: $t('dashboard.jobs.candidates.colScore') },
                    { key: 'stage', label: $t('applications.stage.label') },
                    { key: 'status', label: $t('dashboard.jobs.candidates.colStatus') },
                    { key: 'createdAt', label: $t('dashboard.jobs.candidates.colApplied') },
                  ] as const)"
                  :key="col.key"
                  class="flex items-center gap-2.5 cursor-pointer select-none group"
                >
                  <input type="checkbox" class="sr-only" :checked="visibleCols[col.key]" @change="visibleCols[col.key] = !visibleCols[col.key]" />
                  <span
                    class="size-4 shrink-0 rounded border flex items-center justify-center transition-colors"
                    :class="visibleCols[col.key]
                      ? 'bg-brand-500 border-brand-500'
                      : 'bg-white dark:bg-surface-800 border-surface-300 dark:border-surface-600'"
                  >
                    <Check v-if="visibleCols[col.key]" class="size-3 text-white" :stroke-width="3" />
                  </span>
                  <span class="text-sm text-surface-700 dark:text-surface-300 group-hover:text-surface-900 dark:group-hover:text-surface-100 transition-colors">
                    {{ col.label }}
                  </span>
                </label>
              </div>
            </div>

            <div class="border-t border-surface-100 dark:border-surface-800" />

            <!-- Filter by status -->
            <div>
              <p class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-2">{{ $t('dashboard.jobs.candidates.filterByStatus') }}</p>
              <div class="space-y-1.5">
                <label
                  v-for="s in STATUS_OPTIONS"
                  :key="s"
                  class="flex items-center gap-2.5 cursor-pointer select-none group"
                >
                  <input type="checkbox" class="sr-only" :checked="selectedStatuses.includes(s)" @change="toggleStatus(s)" />
                  <span
                    class="size-4 shrink-0 rounded border flex items-center justify-center transition-colors"
                    :class="selectedStatuses.includes(s)
                      ? 'bg-brand-500 border-brand-500'
                      : 'bg-white dark:bg-surface-800 border-surface-300 dark:border-surface-600'"
                  >
                    <Check v-if="selectedStatuses.includes(s)" class="size-3 text-white" :stroke-width="3" />
                  </span>
                  <span
                  class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset"
                    :class="statusBadgeClasses[s]"
                  >
                    {{ statusLabels[s] }}
                  </span>
                </label>
              </div>
            </div>

            <div class="border-t border-surface-100 dark:border-surface-800" />

            <!-- Stage filter (only shown when the job has a pipeline) -->
            <div v-if="hasPipeline && pipelineStages.length > 0">
              <p class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-2">
                {{ $t('applications.filter.stage') }}
              </p>
              <div class="space-y-1.5">
                <label
                  v-for="stage in pipelineStages"
                  :key="stage.id"
                  class="flex items-center gap-2.5 cursor-pointer select-none group"
                >
                  <input
                    type="radio"
                    class="sr-only"
                    name="stageFilter"
                    :value="stage.id"
                    :checked="selectedStageId === stage.id"
                    @change="selectedStageId = selectedStageId === stage.id ? undefined : stage.id"
                  />
                  <span
                    class="size-4 shrink-0 rounded-full border flex items-center justify-center transition-colors"
                    :class="selectedStageId === stage.id
                      ? 'border-brand-500'
                      : 'bg-white dark:bg-surface-800 border-surface-300 dark:border-surface-600'"
                    :style="selectedStageId === stage.id ? { backgroundColor: stage.color } : {}"
                  >
                    <Check v-if="selectedStageId === stage.id" class="size-2.5 text-white" :stroke-width="3" />
                  </span>
                  <span class="flex items-center gap-1.5 text-sm text-surface-700 dark:text-surface-300">
                    <span
                      class="inline-flex size-2 rounded-full shrink-0"
                      :style="{ backgroundColor: stage.color }"
                    />
                    {{ stage.name }}
                  </span>
                </label>
                <!-- Clear stage selection -->
                <button
                  v-if="selectedStageId"
                  type="button"
                  class="text-xs text-surface-400 hover:text-danger-600 transition-colors mt-1 cursor-pointer"
                  @click="selectedStageId = undefined"
                >
                  {{ $t('applications.filter.allStages') }}
                </button>
              </div>
            </div>

            <div v-if="hasPipeline && pipelineStages.length > 0" class="border-t border-surface-100 dark:border-surface-800" />

            <!-- Score range -->
            <div>
              <p class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-2">{{ $t('dashboard.jobs.candidates.scoreRange') }}</p>
              <div class="flex items-center gap-2">
                <input
                  v-model.number="scoreMin"
                  type="number"
                  min="0"
                  max="100"
                  :placeholder="$t('dashboard.jobs.candidates.scoreMin')"
                  class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-1.5 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span class="text-surface-400 text-xs shrink-0">{{ $t('dashboard.jobs.candidates.scoreTo') }}</span>
                <input
                  v-model.number="scoreMax"
                  type="number"
                  min="0"
                  max="100"
                  :placeholder="$t('dashboard.jobs.candidates.scoreMax')"
                  class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-1.5 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
            </div>

            <!-- Clear -->
            <button
              v-if="activeFilterCount > 0"
              class="inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-danger-600 transition-colors"
              @click="clearFilters"
            >
              <X class="size-3" />
              {{ $t('dashboard.jobs.candidates.clearFilters') }}
            </button>
          </div>
        </div>

        <!-- Batch AI scoring «Обработать» -->
        <div ref="batchMenuRef" class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
            :disabled="isBatchScoring || applications.length === 0"
            @click="batchMenuOpen = !batchMenuOpen"
          >
            <Loader2 v-if="isBatchScoring" class="size-4 animate-spin" />
            <Sparkles v-else class="size-4" />
            <span>{{ isBatchScoring ? 'Обрабатываем…' : 'Обработать' }}</span>
            <span
              v-if="selectedCount > 0"
              class="inline-flex items-center justify-center min-w-5 h-5 rounded-full bg-white/25 text-white text-[11px] font-semibold px-1.5"
            >
              {{ selectedCount }}
            </span>
            <ChevronDownIcon class="size-3.5 opacity-80" />
          </button>
          <div
            v-if="batchMenuOpen"
            class="absolute left-0 top-full mt-2 z-20 w-72 rounded-xl border border-surface-200/80 dark:border-surface-700/80 bg-white dark:bg-surface-900 shadow-xl shadow-surface-900/5 dark:shadow-black/20 p-1.5"
          >
            <button
              type="button"
              class="w-full text-left px-3 py-2.5 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors flex flex-col gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="selectedCount === 0"
              @click="runBatchScore('selected')"
            >
              <span class="text-sm font-medium text-surface-900 dark:text-surface-100">Выбранные ({{ selectedCount }})</span>
              <span class="text-xs text-surface-500">Скоринг только отмеченных в таблице откликов</span>
            </button>
            <button
              type="button"
              class="w-full text-left px-3 py-2.5 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors flex flex-col gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="unscoredCount === 0"
              @click="runBatchScore('all')"
            >
              <span class="text-sm font-medium text-surface-900 dark:text-surface-100">Все необработанные ({{ unscoredCount }})</span>
              <span class="text-xs text-surface-500">Только те, у кого ещё нет оценки</span>
            </button>
            <button
              type="button"
              class="w-full text-left px-3 py-2.5 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors flex flex-col gap-0.5"
              @click="runBatchScore('rescore_all')"
            >
              <span class="text-sm font-medium text-surface-900 dark:text-surface-100">Пересчитать все ({{ applications.length }})</span>
              <span class="text-xs text-surface-500">Скоринг заново для всех откликов вакансии</span>
            </button>
          </div>
        </div>

        <!-- Active filter pills -->
        <template v-if="selectedStatuses.length > 0">
          <span
            v-for="s in selectedStatuses"
            :key="s"
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium capitalize cursor-pointer"
            :class="statusBadgeClasses[s]"
            @click="toggleStatus(s as Status)"
          >
            {{ statusLabels[s] }}
            <X class="size-2.5" />
          </span>
        </template>
        <span
          v-if="scoreMin != null || scoreMax != null"
          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 cursor-pointer"
          @click="scoreMin = undefined; scoreMax = undefined"
        >
          Score {{ scoreMin ?? '0' }}–{{ scoreMax ?? '100' }}
          <X class="size-2.5" />
        </span>
      </div>

      <!-- Empty state (no applications at all) -->
      <div
        v-if="applications.length === 0"
        class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-900 p-12 text-center shadow-sm shadow-surface-900/[0.03] dark:shadow-none"
      >
        <div class="flex size-14 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
          <Users class="size-6 text-surface-400 dark:text-surface-500" />
        </div>
        <h3 class="text-base font-semibold text-surface-700 dark:text-surface-200 mb-1">
          {{ $t('dashboard.jobs.candidates.noCandidatesYet') }}
        </h3>
        <p class="text-sm text-surface-500 dark:text-surface-400 max-w-xs mx-auto">
          Candidates will appear here when they apply to this job or when you link candidates from the Overview tab.
        </p>
      </div>

      <!-- Data table -->
      <div
        v-else
        class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 overflow-hidden shadow-sm shadow-surface-900/[0.03] dark:shadow-none"
      >
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-surface-200/80 dark:border-surface-800/60 bg-surface-50/80 dark:bg-surface-900">
                <!-- Select-all checkbox -->
                <th class="px-4 py-3 w-9">
                  <label class="flex items-center cursor-pointer" @click.stop>
                    <input
                      type="checkbox"
                      class="sr-only peer"
                      :checked="sorted.length > 0 && sorted.every(a => selectedAppIds.has(a.id))"
                      @change="toggleSelectAllVisible"
                    />
                    <span
                      class="size-4 shrink-0 rounded border flex items-center justify-center transition-colors"
                      :class="sorted.length > 0 && sorted.every(a => selectedAppIds.has(a.id))
                        ? 'bg-brand-500 border-brand-500'
                        : 'bg-white dark:bg-surface-800 border-surface-300 dark:border-surface-600'"
                    >
                      <Check v-if="sorted.length > 0 && sorted.every(a => selectedAppIds.has(a.id))" class="size-3 text-white" stroke-width="3" />
                    </span>
                  </label>
                </th>
                <!-- Name always visible -->
                <th class="px-4 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide select-none">
                  <button
                    class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors"
                    @click="toggleSort('name')"
                  >
                    {{ $t('dashboard.jobs.candidates.colName') }}
                    <ChevronUp v-if="sortKey === 'name' && sortDir === 'asc'" class="size-3" />
                    <ChevronDown v-else-if="sortKey === 'name' && sortDir === 'desc'" class="size-3" />
                    <ChevronsUpDown v-else class="size-3 opacity-40" />
                  </button>
                </th>
                <th v-if="visibleCols.email" class="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide select-none">
                  <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('email')">
                    {{ $t('dashboard.jobs.candidates.colEmail') }}
                    <ChevronUp v-if="sortKey === 'email' && sortDir === 'asc'" class="size-3" />
                    <ChevronDown v-else-if="sortKey === 'email' && sortDir === 'desc'" class="size-3" />
                    <ChevronsUpDown v-else class="size-3 opacity-40" />
                  </button>
                </th>
                <th v-if="visibleCols.score" class="px-4 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide select-none">
                  <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('score')">
                    {{ $t('dashboard.jobs.candidates.colScore') }}
                    <ChevronUp v-if="sortKey === 'score' && sortDir === 'asc'" class="size-3" />
                    <ChevronDown v-else-if="sortKey === 'score' && sortDir === 'desc'" class="size-3" />
                    <ChevronsUpDown v-else class="size-3 opacity-40" />
                  </button>
                </th>
                <th v-if="visibleCols.stage" class="px-4 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide select-none">
                  {{ $t('applications.stage.label') }}
                </th>
                <th v-if="visibleCols.status" class="px-4 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide select-none">
                  <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('status')">
                    {{ $t('dashboard.jobs.candidates.colStatus') }}
                    <ChevronUp v-if="sortKey === 'status' && sortDir === 'asc'" class="size-3" />
                    <ChevronDown v-else-if="sortKey === 'status' && sortDir === 'desc'" class="size-3" />
                    <ChevronsUpDown v-else class="size-3 opacity-40" />
                  </button>
                </th>
                <th v-if="visibleCols.createdAt" class="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide select-none">
                  <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('createdAt')">
                    {{ $t('dashboard.jobs.candidates.colApplied') }}
                    <ChevronUp v-if="sortKey === 'createdAt' && sortDir === 'asc'" class="size-3" />
                    <ChevronDown v-else-if="sortKey === 'createdAt' && sortDir === 'desc'" class="size-3" />
                    <ChevronsUpDown v-else class="size-3 opacity-40" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-100 dark:divide-surface-800/60 bg-white dark:bg-surface-950">
              <!-- No results after filtering -->
              <tr v-if="sorted.length === 0">
                <td
                  :colspan="2 + Object.values(visibleCols).filter(Boolean).length"
                  class="px-4 py-10 text-center text-sm text-surface-400"
                >
                  {{ $t('dashboard.jobs.candidates.noMatchFilters') }}
                </td>
              </tr>
              <tr
                v-for="app in sorted"
                :key="app.id"
                class="cursor-pointer transition-all duration-150"
                :class="selectedAppId === app.id
                  ? 'bg-brand-50/70 dark:bg-brand-950/20'
                  : 'hover:bg-surface-50/80 dark:hover:bg-surface-900/60'"
                @click="selectRow(app.id)"
              >
                <td class="px-3 py-3 whitespace-nowrap" @click.stop>
                  <input
                    type="checkbox"
                    class="size-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                    :checked="selectedAppIds.has(app.id)"
                    @change="toggleAppSelection(app.id)"
                  >
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <div class="flex items-center gap-3">
                    <div
                      class="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-150"
                      :class="selectedAppId === app.id
                        ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/20 dark:bg-brand-600 dark:shadow-brand-500/10'
                        : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300'"
                    >
                      {{ getCandidateInitials(app.candidateFirstName, app.candidateLastName) }}
                    </div>
                    <span class="font-medium text-surface-900 dark:text-surface-100">
                      {{ formatPersonName(app.candidateFirstName, app.candidateLastName) }}
                    </span>
                  </div>
                </td>
                <td v-if="visibleCols.email" class="hidden sm:table-cell px-4 py-3 text-surface-600 dark:text-surface-300 max-w-[220px] truncate">
                  <a
                    :href="`mailto:${app.candidateEmail}`"
                    target="_blank"
                    class="hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
                  >{{ app.candidateEmail }}</a>
                </td>
                <td v-if="visibleCols.score" class="px-4 py-3">
                  <span
                    v-if="app.score != null"
                    class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset"
                    :class="scoreClass(app.score)"
                  >
                    {{ app.score }} pts
                  </span>
                  <span v-else class="text-surface-400 dark:text-surface-500 text-xs">—</span>
                </td>
                <td v-if="visibleCols.stage" class="px-4 py-3" @click.stop>
                  <ApplicationStagePicker
                    :application-id="app.id"
                    :current-stage-id="(app as { currentStageId?: string | null }).currentStageId ?? null"
                    @stage-changed="refreshApps()"
                  />
                </td>
                <td v-if="visibleCols.status" class="px-4 py-3">
                  <span
                    class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset"
                    :class="statusBadgeClasses[app.status] ?? 'bg-surface-100 text-surface-600 ring-surface-200'"
                  >
                    {{ app.status }}
                  </span>
                </td>
                <td v-if="visibleCols.createdAt" class="hidden md:table-cell px-4 py-3 text-surface-500 dark:text-surface-400 whitespace-nowrap text-xs font-medium">
                  <TimelineDateLink :date="app.createdAt">{{ timeAgo(app.createdAt) }}</TimelineDateLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Footer / count -->
        <div class="px-4 py-3 border-t border-surface-200/80 dark:border-surface-800/60 bg-surface-50/80 dark:bg-surface-900">
          <p class="text-xs font-medium text-surface-500 dark:text-surface-400">
            {{ $t('dashboard.jobs.candidates.counter', { shown: sorted.length, total })}}
          </p>
        </div>
      </div>
    </template>

    <!-- Detail sidebar -->
    <CandidateDetailSidebar
      v-if="selectedAppId"
      :application-id="selectedAppId"
      :open="sidebarOpen"
      @close="closeSidebar"
      @updated="handleSidebarUpdated"
    />
  </div>
</template>
