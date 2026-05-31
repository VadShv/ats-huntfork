<script setup lang="ts">
import { FileText, Search, X, Briefcase, Mail, Clock, ArrowUp, ArrowDown, ArrowUpDown, SlidersHorizontal, Maximize2, Minimize2, Check, ChevronDown, Loader2 } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Applications — Reqcore',
  description: 'Manage applications across all jobs',
})

// ── Column visibility ─────────────────────────────────────────────────────────

const COLUMNS_STORAGE_KEY = 'reqcore:columns:applications'

const defaultColumnVisibility = {
  email: true,
  job: true,
  stage: true,
  status: true,
  score: true,
  applied: true,
}

const visibleColumns = ref<Record<string, boolean>>({ ...defaultColumnVisibility })

const { definitions: propertyDefs } = useProperties({ entityType: () => 'application' })

const applicationColumns = computed(() => [
  { key: 'candidate', label: 'Candidate', required: true },
  { key: 'email', label: 'Email' },
  { key: 'job', label: 'Job' },
  { key: 'stage', label: t('applications.stage.label') },
  { key: 'status', label: 'Status' },
  { key: 'score', label: 'Score' },
  { key: 'applied', label: 'Applied' },
  ...propertyDefs.value.map((d) => ({ key: `prop_${d.id}`, label: d.name })),
])

onMounted(() => {
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY)
    if (raw) visibleColumns.value = { ...defaultColumnVisibility, ...JSON.parse(raw) }
  } catch {}
})

watch(visibleColumns, (val) => {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(val)) } catch {}
}, { deep: true })

const route = useRoute()
const router = useRouter()

// ── Search ────────────────────────────────────────────────────────────────────

const searchInput = ref('')
const debouncedSearch = ref('')

let debounceTimer: ReturnType<typeof setTimeout>
watch(searchInput, (val) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = val.trim().toLowerCase()
  }, 250)
})

// ── Status filter ─────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const
type Status = typeof STATUS_OPTIONS[number]

const initialAppStatus = STATUS_OPTIONS.includes(route.query.status as any)
  ? (route.query.status as Status)
  : undefined
const activeStatus = useState<Status | undefined>('app-filter-status', () => initialAppStatus)
// Ensure the state matches the URL on navigation (useState caches across client-side navigations)
if (initialAppStatus !== undefined) {
  activeStatus.value = initialAppStatus
}

// Sync the URL when the status filter changes
watch(activeStatus, (newStatus) => {
  const query = { ...route.query }
  if (newStatus) {
    query.status = newStatus
  }
  else {
    delete query.status
  }
  router.replace({ query })
})

const statusFilter = computed(() => activeStatus.value)
const propertyFilters = ref<import('~~/shared/properties').PropertyFilter[]>([])

// ── Stage filter (server-side, via stageId param) ──────────────────────────────

const initialStageId = typeof route.query.stageId === 'string' ? route.query.stageId : undefined
const activeStageId = useState<string | undefined>('app-filter-stageId', () => initialStageId)
if (initialStageId !== undefined) {
  activeStageId.value = initialStageId
}

watch(activeStageId, (newStageId) => {
  const query = { ...route.query }
  if (newStageId) {
    query.stageId = newStageId
  }
  else {
    delete query.stageId
  }
  router.replace({ query })
})

// Fetch stages-summary for the stage filter dropdown
type StageOption = { id: string; name: string; color: string; type: string; displayOrder: number }
type PipelineGroup = { pipelineId: string; pipelineName: string; stages: StageOption[] }

const { data: stagesSummaryData } = useFetch<PipelineGroup[]>('/api/pipelines/stages-summary', {
  key: 'stages-summary',
  headers: useRequestHeaders(['cookie']),
})
const stageGroups = computed<PipelineGroup[]>(() => stagesSummaryData.value ?? [])

// Flat map for label lookup
const stageById = computed(() => {
  const map = new Map<string, StageOption>()
  for (const g of stageGroups.value) {
    for (const s of g.stages) map.set(s.id, s)
  }
  return map
})

const { applications, total, fetchStatus, error, refresh } = useApplications({
  status: statusFilter,
  stageId: activeStageId,
  propertyFilters,
})

const toast = useToast()
const { formatPersonName } = useOrgSettings()
const { t } = useI18n()

// ── Job filter (client-side) ──────────────────────────────────────────────────

const activeJobId = ref<string | undefined>(undefined)

const uniqueJobs = computed(() => {
  const map = new Map<string, string>()
  for (const app of applications.value) {
    if (!map.has(app.jobId)) map.set(app.jobId, app.jobTitle)
  }
  return Array.from(map, ([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title))
})

// ── Sorting ───────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'email' | 'job' | 'status' | 'score' | 'created'
type SortDir = 'asc' | 'desc'

const sortKey = ref<SortKey>('created')
const sortDir = ref<SortDir>('desc')

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'created' || key === 'score' ? 'desc' : 'asc'
  }
}

// ── Filtered + sorted list ────────────────────────────────────────────────────

const filteredApplications = computed(() => {
  let list = [...applications.value]

  // Job filter
  if (activeJobId.value) {
    list = list.filter(app => app.jobId === activeJobId.value)
  }

  // Search filter (client-side)
  if (debouncedSearch.value) {
    const q = debouncedSearch.value
    list = list.filter(app =>
      formatPersonName(app.candidateFirstName, app.candidateLastName).toLowerCase().includes(q)
      || `${app.candidateFirstName} ${app.candidateLastName}`.toLowerCase().includes(q)
      || app.candidateEmail.toLowerCase().includes(q)
      || app.jobTitle.toLowerCase().includes(q),
    )
  }

  // Sort
  const dir = sortDir.value === 'asc' ? 1 : -1
  list.sort((a, b) => {
    switch (sortKey.value) {
      case 'name':
        return dir * formatPersonName(a.candidateFirstName, a.candidateLastName).localeCompare(formatPersonName(b.candidateFirstName, b.candidateLastName))
      case 'email':
        return dir * a.candidateEmail.localeCompare(b.candidateEmail)
      case 'job':
        return dir * a.jobTitle.localeCompare(b.jobTitle)
      case 'status':
        return dir * a.status.localeCompare(b.status)
      case 'score':
        return dir * ((a.score ?? -1) - (b.score ?? -1))
      case 'created':
        return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      default:
        return 0
    }
  })

  return list
})

const hasActiveFilters = computed(() =>
  activeStatus.value != null
  || activeJobId.value != null
  || activeStageId.value != null
  || debouncedSearch.value.length > 0
  || propertyFilters.value.length > 0,
)

function clearAllFilters() {
  activeStatus.value = undefined
  activeJobId.value = undefined
  activeStageId.value = undefined
  searchInput.value = ''
  debouncedSearch.value = ''
  propertyFilters.value = []
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  if (score >= 75) return 'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950 dark:text-success-400 dark:ring-success-800'
  if (score >= 40) return 'bg-warning-50 text-warning-700 ring-warning-200 dark:bg-warning-950 dark:text-warning-400 dark:ring-warning-800'
  return 'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-950 dark:text-danger-400 dark:ring-danger-800'
}

const statusBadgeClasses: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  screening: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  interview: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  offer: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400',
  hired: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
  rejected: 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400',
}

const statusDotClasses: Record<string, string> = {
  new: 'bg-blue-500',
  screening: 'bg-violet-500',
  interview: 'bg-amber-500',
  offer: 'bg-teal-500',
  hired: 'bg-green-600',
  rejected: 'bg-surface-400 dark:bg-surface-500',
}

const statusLabels: Record<Status, string> = {
  new: 'New',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
}

// ── Drawer + Saved Views ──────────────────────────────────────────────────────

type ApplicationsViewSettings = {
  status?: Status
  jobId?: string
  stageId?: string
  propertyFilters: import('~~/shared/properties').PropertyFilter[]
  sortKey: SortKey
  sortDir: SortDir
  visibleColumns?: Record<string, boolean>
}

const defaultSettings: ApplicationsViewSettings = {
  status: undefined,
  jobId: undefined,
  stageId: undefined,
  propertyFilters: [],
  sortKey: 'created',
  sortDir: 'desc',
  visibleColumns: undefined,
}

const drawerOpen = ref(false)
const isFullscreen = ref(false)
const currentSettings = computed<ApplicationsViewSettings>(() => ({
  status: activeStatus.value,
  jobId: activeJobId.value,
  stageId: activeStageId.value,
  propertyFilters: [...propertyFilters.value],
  sortKey: sortKey.value,
  sortDir: sortDir.value,
  visibleColumns: { ...visibleColumns.value },
}))

function applySettings(s: ApplicationsViewSettings) {
  activeStatus.value = s.status
  activeJobId.value = s.jobId
  activeStageId.value = s.stageId
  propertyFilters.value = [...(s.propertyFilters ?? [])]
  sortKey.value = s.sortKey
  sortDir.value = s.sortDir
  if (s.visibleColumns) visibleColumns.value = { ...defaultColumnVisibility, ...s.visibleColumns }
}

const {
  views,
  activeViewId,
  applyView,
  saveView,
  updateView,
  deleteView,
  setDefault,
  clearActive,
} = useSavedViews<ApplicationsViewSettings>('applications', defaultSettings)

// On first mount, if a default view exists, apply its settings.
onMounted(() => {
  nextTick(() => {
    if (activeViewId.value) {
      const s = applyView(activeViewId.value)
      if (s) applySettings(s)
    }
  })
})

function settingsEqual(a: ApplicationsViewSettings, b: ApplicationsViewSettings) {
  return a.status === b.status
    && a.jobId === b.jobId
    && a.stageId === b.stageId
    && a.sortKey === b.sortKey
    && a.sortDir === b.sortDir
    && JSON.stringify(a.propertyFilters ?? []) === JSON.stringify(b.propertyFilters ?? [])
    && JSON.stringify(a.visibleColumns ?? {}) === JSON.stringify(b.visibleColumns ?? {})
}

const isDirty = computed(() => {
  const view = views.value.find(v => v.id === activeViewId.value)
  if (!view) return false
  return !settingsEqual(currentSettings.value, { ...defaultSettings, ...view.settings })
})

// Mark the view inactive (chip-level highlight) when the user manually edits filters.
watch(currentSettings, () => {
  if (!activeViewId.value) return
  if (isDirty.value) {
    // Keep the chip active but show the dirty marker via SavedViewsBar.
  }
}, { deep: true })

function onSelectView(id: string | null) {
  if (id == null) {
    clearActive()
    applySettings(defaultSettings)
    return
  }
  const s = applyView(id)
  if (s) applySettings(s)
}

function onSaveView(name: string) {
  saveView(name, currentSettings.value)
}

function onUpdateView(id: string) {
  updateView(id, { settings: currentSettings.value })
}

const drawerActiveCount = computed(() =>
  [activeStatus.value, activeJobId.value, activeStageId.value].filter(Boolean).length + propertyFilters.value.length,
)

// ── Property value lookup helper ──────────────────────────────────────────────
function getPropertyValue(entity: { properties?: import('~~/shared/properties').PropertyEntry[] | null }, definitionId: string): unknown {
  return entity.properties?.find((p) => p.definition.id === definitionId)?.value ?? null
}

// ── Application detail drawer ─────────────────────────────────────────────────
const selectedApplicationId = ref<string | null>(null)

// ── Bulk selection ────────────────────────────────────────────────────────────
const selectedIds = ref<Set<string>>(new Set())
const bulkStageMenuOpen = ref(false)
const isBulkOperating = ref(false)

const isAllSelected = computed(() =>
  filteredApplications.value.length > 0
  && filteredApplications.value.every(app => selectedIds.value.has(app.id)),
)

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(filteredApplications.value.map(a => a.id))
  }
}

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

async function bulkReject() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  isBulkOperating.value = true
  const results = await Promise.allSettled(
    ids.map(id => $fetch(`/api/applications/${id}/stage`, { method: 'PATCH', body: { status: 'rejected' }, headers: useRequestHeaders(['cookie']) }))
  )
  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    toast.error(`Ошибка: ${failed} из ${ids.length}`, { message: 'Некоторые отклики не удалось отклонить.' })
  }
  if (succeeded > 0) {
    toast.success(`Отклонено: ${succeeded} из ${ids.length}`)
    selectedIds.value = new Set()
    await refresh()
  }
  isBulkOperating.value = false
}

type BulkStageOption = { id: string; name: string; color: string }
const bulkAvailableStages = ref<BulkStageOption[]>([])
const bulkStagesLoading = ref(false)

async function loadBulkStages() {
  if (bulkAvailableStages.value.length > 0) return
  bulkStagesLoading.value = true
  try {
    type PipelineGroup = { pipelineId: string; pipelineName: string; stages: BulkStageOption[] }
    const data = await $fetch<PipelineGroup[]>('/api/pipelines/stages-summary', { headers: useRequestHeaders(['cookie']) })
    bulkAvailableStages.value = data.flatMap(g => g.stages)
  } catch {
    toast.error('Не удалось загрузить этапы')
  } finally {
    bulkStagesLoading.value = false
  }
}

async function bulkMoveToStage(stageId: string, stageName: string) {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  bulkStageMenuOpen.value = false
  isBulkOperating.value = true
  const results = await Promise.allSettled(
    ids.map(id => $fetch(`/api/applications/${id}/stage`, { method: 'PATCH', body: { stageId }, headers: useRequestHeaders(['cookie']) }))
  )
  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length
  if (succeeded > 0) {
    toast.success(`Перенесено в "${stageName}": ${succeeded} из ${ids.length}`)
    selectedIds.value = new Set()
    await refresh()
  }
  if (failed > 0) {
    toast.error(`Ошибка: ${failed} из ${ids.length}`, { message: 'Некоторые отклики не удалось перенести.' })
  }
  isBulkOperating.value = false
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">{{ $t('dashboard.applications.title') }}</h1>
        <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">
          Track candidates through your hiring pipeline.
        </p>
      </div>
    </div>

    <!-- Search + Views + Filters -->
    <div class="flex items-center gap-2 mb-4">
      <div class="relative flex-1">
        <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-surface-400" />
        <input
          v-model="searchInput"
          type="text"
          :placeholder="$t('dashboard.applications.searchPlaceholder')"
          class="w-full rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 pl-10 pr-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
        />
      </div>
      <SavedViewsMenu
        :views="views"
        :active-view-id="activeViewId"
        :is-dirty="isDirty"
        @select="onSelectView"
        @save="onSaveView"
        @update="onUpdateView"
        @delete="deleteView"
        @set-default="setDefault"
      />
      <ColumnsMenu
        v-model="visibleColumns"
        :columns="applicationColumns"
      />
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
        :class="drawerActiveCount > 0
          ? 'border-surface-400 bg-surface-100 text-surface-800 dark:border-surface-500 dark:bg-surface-800 dark:text-surface-200'
          : 'border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'"
        @click="drawerOpen = true"
      >
        <SlidersHorizontal class="size-4" />
        Filters
        <span
          v-if="drawerActiveCount > 0"
          class="inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-surface-700 dark:bg-surface-300 text-white dark:text-surface-900 text-[10px] font-semibold"
        >{{ drawerActiveCount }}</span>
      </button>
      <button
        v-if="hasActiveFilters"
        class="inline-flex items-center gap-1 text-xs text-surface-400 hover:text-danger-600 transition-colors"
        @click="clearAllFilters"
      >
        <X class="size-3" />
        Clear
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-2.5 py-2 text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
        :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen table'"
        @click="isFullscreen = !isFullscreen"
      >
        <Maximize2 v-if="!isFullscreen" class="size-4" />
        <Minimize2 v-else class="size-4" />
      </button>
    </div>

    <!-- Filter drawer -->
    <FilterDrawer
      v-model="drawerOpen"
      title="Filter applications"
      description="Customize your view, then save it for quick access."
      :active-count="drawerActiveCount"
      saveable
      :default-save-name="`View ${views.length + 1}`"
      @reset="applySettings(defaultSettings)"
      @save-view="onSaveView"
    >
      <div class="space-y-6">
        <!-- Status -->
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Status</label>
          <div class="flex flex-wrap gap-1.5">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              :class="!activeStatus
                ? 'bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'"
              @click="activeStatus = undefined"
            >Any</button>
            <button
              v-for="s in STATUS_OPTIONS"
              :key="s"
              type="button"
              class="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              :class="activeStatus === s
                ? 'bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'"
              @click="activeStatus = activeStatus === s ? undefined : s"
            >{{ statusLabels[s] }}</button>
          </div>
        </div>

        <!-- Job -->
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Job</label>
          <select
            v-model="activeJobId"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          >
            <option :value="undefined">All jobs</option>
            <option v-for="j in uniqueJobs" :key="j.id" :value="j.id">{{ j.title }}</option>
          </select>
        </div>

        <!-- Stage filter (grouped by pipeline) -->
        <div v-if="stageGroups.length > 0">
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">
            {{ $t('applications.filter.stage') }}
          </label>
          <select
            v-model="activeStageId"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          >
            <option :value="undefined">{{ $t('applications.filter.allStages') }}</option>
            <optgroup
              v-for="group in stageGroups"
              :key="group.pipelineId"
              :label="group.pipelineName"
            >
              <option
                v-for="stage in group.stages"
                :key="stage.id"
                :value="stage.id"
              >
                {{ stage.name }}
              </option>
            </optgroup>
          </select>
          <!-- Active stage badge -->
          <div v-if="activeStageId && stageById.get(activeStageId)" class="mt-1.5 flex items-center gap-1.5">
            <span
              class="inline-flex size-2 rounded-full shrink-0"
              :style="{ backgroundColor: stageById.get(activeStageId)!.color }"
            />
            <span class="text-xs text-surface-500 dark:text-surface-400">
              {{ stageById.get(activeStageId)!.name }}
            </span>
            <button
              type="button"
              class="ml-auto text-xs text-danger-500 hover:text-danger-700 transition-colors cursor-pointer"
              @click="activeStageId = undefined"
            >
              {{ $t('common.cancel') }}
            </button>
          </div>
        </div>

        <!-- Sort -->
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Sort by</label>
          <div class="flex gap-2">
            <select
              v-model="sortKey"
              class="flex-1 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            >
              <option value="created">Applied date</option>
              <option value="name">Candidate name</option>
              <option value="email">Email</option>
              <option value="job">Job title</option>
              <option value="status">Status</option>
              <option value="score">Score</option>
            </select>
            <select
              v-model="sortDir"
              class="w-32 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        </div>

        <!-- Property filters -->
        <div v-if="propertyDefs.length > 0">
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Properties</label>
          <PropertyFilterBar v-model="propertyFilters" entity-type="application" />
        </div>

        <!-- Columns -->
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Columns</label>
          <div class="space-y-1.5">
            <label
              v-for="col in applicationColumns.filter(c => !c.required)"
              :key="col.key"
              class="flex items-center gap-2.5 cursor-pointer select-none group"
            >
              <span
                class="flex size-4 shrink-0 items-center justify-center rounded border transition-colors"
                :class="visibleColumns[col.key] ? 'bg-brand-600 border-brand-600 text-white' : 'border-surface-300 dark:border-surface-600'"
                @click="visibleColumns = { ...visibleColumns, [col.key]: !visibleColumns[col.key] }"
              >
                <Check v-if="visibleColumns[col.key]" class="size-3" />
              </span>
              <span class="text-sm text-surface-700 dark:text-surface-300 group-hover:text-surface-900 dark:group-hover:text-surface-100 transition-colors">{{ col.label }}</span>
            </label>
          </div>
        </div>
      </div>
    </FilterDrawer>

    <!-- Loading skeleton -->
    <div v-if="fetchStatus === 'pending'" class="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-800">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-800">
            <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">{{ $t('dashboard.applications.table.candidate') }}</th>
            <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden lg:table-cell">{{ $t('dashboard.applications.table.email') }}</th>
            <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden md:table-cell">{{ $t('dashboard.applications.table.job') }}</th>
            <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">{{ $t('applications.stage.label') }}</th>
            <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">{{ $t('dashboard.applications.table.status') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
          <SkeletonRow v-for="i in 5" :key="i" :avatar="false" :columns="5" />
        </tbody>
      </table>
    </div>

    <!-- Error -->
    <div
      v-else-if="error"
      class="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700"
    >
      {{ $t('dashboard.applications.failedToLoad') }}
      <button class="underline ml-1" @click="refresh()">{{ $t('dashboard.applications.retry') }}</button>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="applications.length === 0"
      class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-16 text-center"
    >
      <FileText class="size-10 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
      <h3 class="text-base font-semibold text-surface-700 dark:text-surface-200 mb-1">{{ $t('dashboard.applications.empty') }}</h3>
      <p class="text-sm text-surface-500 dark:text-surface-400">
        Applications will appear here when candidates apply to your jobs or when you manually link candidates.
      </p>
    </div>

    <!-- No results after filtering -->
    <div
      v-else-if="filteredApplications.length === 0"
      class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-12 text-center"
    >
      <Search class="size-8 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
      <h3 class="text-base font-semibold text-surface-700 dark:text-surface-200 mb-1">No matching applications</h3>
      <p class="text-sm text-surface-500 dark:text-surface-400 mb-3">
        Try adjusting your search or filters.
      </p>
      <button
        class="text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors"
        @click="clearAllFilters"
      >
        Clear all filters
      </button>
    </div>

    <!-- Application table -->
    <div v-else>
      <Teleport to="body" :disabled="!isFullscreen">
        <div :class="isFullscreen ? 'fixed inset-0 z-50 bg-white dark:bg-surface-950 flex flex-col' : ''">
          <!-- Fullscreen header -->
          <div v-if="isFullscreen" class="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-800 shrink-0 bg-white dark:bg-surface-950">
            <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">
              Applications — {{ filteredApplications.length }} result{{ filteredApplications.length === 1 ? '' : 's' }}
            </span>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-800 px-2.5 py-1.5 text-sm text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
              @click="isFullscreen = false"
            >
              <Minimize2 class="size-4" />
              Exit fullscreen
            </button>
          </div>
          <div :class="isFullscreen ? 'flex-1 overflow-auto p-4' : ''">
            <div class="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-800">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-800">
              <th class="w-10 px-4 py-3 text-left">
                <input
                  type="checkbox"
                  :checked="isAllSelected"
                  aria-label="Выбрать все"
                  class="size-4 rounded border-surface-300 dark:border-surface-600 accent-brand-600 cursor-pointer"
                  @change="toggleSelectAll"
                />
              </th>
              <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('name')">
                  Candidate
                  <ArrowUp v-if="sortKey === 'name' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'name' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <th v-if="visibleColumns.email" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden lg:table-cell">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('email')">
                  Email
                  <ArrowUp v-if="sortKey === 'email' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'email' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <th v-if="visibleColumns.job" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden md:table-cell">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('job')">
                  Job
                  <ArrowUp v-if="sortKey === 'job' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'job' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <th v-if="visibleColumns.stage" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 whitespace-nowrap">
                {{ t('applications.stage.label') }}
              </th>
              <th v-if="visibleColumns.status" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('status')">
                  Status
                  <ArrowUp v-if="sortKey === 'status' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'status' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <th v-if="visibleColumns.score" class="text-center px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden sm:table-cell">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('score')">
                  Score
                  <ArrowUp v-if="sortKey === 'score' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'score' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <th v-if="visibleColumns.applied" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('created')">
                  Applied
                  <ArrowUp v-if="sortKey === 'created' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'created' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <template v-for="d in propertyDefs" :key="d.id">
                <th v-if="visibleColumns[`prop_${d.id}`]" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 whitespace-nowrap">
                  {{ d.name }}
                </th>
              </template>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
            <tr
              v-for="app in filteredApplications"
              :key="app.id"
              class="group bg-white dark:bg-surface-900 hover:bg-surface-50 dark:hover:bg-surface-800/60 transition-colors cursor-pointer [&>td]:align-top"
              :class="{ 'bg-brand-50/30 dark:bg-brand-950/20': selectedIds.has(app.id) }"
              @click="selectedApplicationId = app.id"
            >
              <td class="w-10 px-4 py-3" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedIds.has(app.id)"
                  :aria-label="`Выбрать ${formatPersonName(app.candidateFirstName, app.candidateLastName)}`"
                  class="size-4 rounded border-surface-300 dark:border-surface-600 accent-brand-600 cursor-pointer"
                  @change="toggleSelect(app.id)"
                />
              </td>
              <td class="px-4 py-3">
                <button
                  type="button"
                  class="font-semibold text-surface-900 dark:text-surface-100 group-hover:text-brand-600 transition-colors whitespace-nowrap text-left"
                  @click.stop="selectedApplicationId = app.id"
                >
                  {{ formatPersonName(app.candidateFirstName, app.candidateLastName) }}
                </button>
              </td>
              <td v-if="visibleColumns.email" class="px-4 py-3 text-surface-500 dark:text-surface-400 hidden lg:table-cell">
                <span class="inline-flex items-center gap-1.5">
                  <Mail class="size-3.5 shrink-0" />
                  <span class="truncate max-w-[200px]">{{ app.candidateEmail }}</span>
                </span>
              </td>
              <td v-if="visibleColumns.job" class="px-4 py-3 text-surface-600 dark:text-surface-300 hidden md:table-cell">
                <span class="inline-flex items-center gap-1.5 truncate max-w-[200px]">
                  <Briefcase class="size-3.5 shrink-0 text-surface-400" />
                  {{ app.jobTitle }}
                </span>
              </td>
              <td v-if="visibleColumns.stage" class="px-4 py-3" @click.stop>
                <ApplicationStagePicker
                  :application-id="app.id"
                  :current-stage-id="(app as { currentStageId?: string | null }).currentStageId ?? null"
                  @stage-changed="refresh()"
                />
              </td>
              <td v-if="visibleColumns.status" class="px-4 py-3">
                <span
                  class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium capitalize whitespace-nowrap"
                  :class="statusBadgeClasses[app.status] ?? 'bg-surface-100 text-surface-600'"
                >
                  <span class="size-1.5 rounded-full" :class="statusDotClasses[app.status] ?? 'bg-surface-400'" />
                  {{ statusLabels[app.status as Status] ?? app.status }}
                </span>
              </td>
              <td v-if="visibleColumns.score" class="px-4 py-3 text-center hidden sm:table-cell">
                <span
                  v-if="app.score != null"
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset"
                  :class="scoreClass(app.score)"
                >
                  {{ app.score }}%
                </span>
                <span v-else class="text-surface-300 dark:text-surface-600">—</span>
              </td>
              <td v-if="visibleColumns.applied" class="px-4 py-3 text-surface-400 whitespace-nowrap">
                <TimelineDateLink :date="app.createdAt" class="inline-flex items-center gap-1.5">
                  <Clock class="size-3.5 shrink-0" />
                  {{ timeAgo(app.createdAt) }}
                </TimelineDateLink>
              </td>
              <!-- Property columns -->
              <template v-for="d in propertyDefs" :key="d.id">
                <td v-if="visibleColumns[`prop_${d.id}`]" class="px-4 py-3 text-surface-500 dark:text-surface-400 align-top">
                  <PropertyTableCell
                    entity-type="application"
                    :entity-id="app.id"
                    :definition="d"
                    :value="getPropertyValue(app, d.id)"
                  />
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Footer count -->
      <p class="text-xs text-surface-400 pt-3">
        Showing {{ filteredApplications.length }} of {{ total }} application{{ total === 1 ? '' : 's' }}
      </p>
          </div>
        </div>
      </Teleport>
    </div>
  </div>

  <!-- Application detail drawer -->
  <ApplicationDetailDrawer
    v-if="selectedApplicationId"
    :application-id="selectedApplicationId"
    @close="selectedApplicationId = null"
  />

  <!-- Bulk actions sticky panel -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      leave-active-class="transition-all duration-150 ease-in"
      enter-from-class="opacity-0 translate-y-4"
      enter-to-class="opacity-100 translate-y-0"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-4"
    >
      <div
        v-if="selectedIds.size > 0"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-2xl px-4 py-3 text-sm"
      >
        <span class="font-medium text-surface-700 dark:text-surface-200 whitespace-nowrap mr-1">
          Выбрано: {{ selectedIds.size }}
        </span>
        <!-- Stage picker -->
        <div class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
            :disabled="isBulkOperating"
            @click="bulkStageMenuOpen = !bulkStageMenuOpen; loadBulkStages()"
          >
            <Loader2 v-if="bulkStagesLoading" class="size-3.5 animate-spin" />
            Перенести в этап
            <ChevronDown class="size-3.5" />
          </button>
          <div
            v-if="bulkStageMenuOpen && bulkAvailableStages.length > 0"
            class="absolute bottom-full mb-1 left-0 min-w-[180px] rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-xl py-1 z-10"
          >
            <button
              v-for="stage in bulkAvailableStages"
              :key="stage.id"
              type="button"
              class="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              @click="bulkMoveToStage(stage.id, stage.name)"
            >
              <span class="inline-flex size-2 rounded-full shrink-0" :style="{ backgroundColor: stage.color }" />
              {{ stage.name }}
            </button>
          </div>
        </div>
        <!-- Reject all -->
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950/50 px-3 py-1.5 text-sm font-medium text-danger-700 dark:text-danger-400 hover:bg-danger-100 dark:hover:bg-danger-950 transition-colors"
          :disabled="isBulkOperating"
          @click="bulkReject"
        >
          <Loader2 v-if="isBulkOperating" class="size-3.5 animate-spin" />
          Отклонить
        </button>
        <!-- Cancel -->
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-1.5 text-sm font-medium text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
          @click="selectedIds = new Set(); bulkStageMenuOpen = false"
        >
          Отмена
        </button>
      </div>
    </Transition>
  </Teleport>
</template>
