<script setup lang="ts">
import {
  Briefcase, Bell, Plus, Kanban,
  MapPin, Search, SlidersHorizontal, X,
  LayoutGrid, List, Table2, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'My Jobs',
  description: 'Your active job postings',
})

const { activeOrg } = useCurrentOrg()
const localePath = useLocalePath()
const { t } = useI18n()

// ─────────────────────────────────────────────
// Stage config for clickable pipeline counts
// ─────────────────────────────────────────────

const stageConfig = computed(() => [
  { key: 'new', label: t('dashboard.jobs.pipeline.stages.new'), textColor: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-950/40' },
  { key: 'screening', label: t('dashboard.jobs.pipeline.stages.screening'), textColor: 'text-violet-600 dark:text-violet-400', bgColor: 'bg-violet-50 dark:bg-violet-950/40' },
  { key: 'interview', label: t('dashboard.jobs.pipeline.stages.interview'), textColor: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-950/40' },
  { key: 'offer', label: t('dashboard.jobs.pipeline.stages.offer'), textColor: 'text-teal-600 dark:text-teal-400', bgColor: 'bg-teal-50 dark:bg-teal-950/40' },
  { key: 'hired', label: t('dashboard.jobs.pipeline.stages.hired'), textColor: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-950/40' },
  { key: 'rejected', label: t('dashboard.jobs.pipeline.stages.rejected'), textColor: 'text-surface-500 dark:text-surface-400', bgColor: 'bg-surface-100 dark:bg-surface-800' },
] as const)

function getStageCount(pipeline: any, key: string): number {
  return pipeline?.[key] ?? 0
}

// ─────────────────────────────────────────────
// Fetch jobs with pipeline data
// ─────────────────────────────────────────────

const { jobs, total, fetchStatus, error, refresh } = useJobs()

// ─────────────────────────────────────────────
// Job status → UiBadge tone mapping
// ─────────────────────────────────────────────

type JobStatus = 'draft' | 'open' | 'closed' | 'archived'

const statusToneMap: Record<JobStatus, 'neutral' | 'success' | 'warning'> = {
  draft: 'neutral',
  open: 'success',
  closed: 'warning',
  archived: 'neutral',
}

function statusTone(s: string) {
  return (statusToneMap[s as JobStatus] ?? 'neutral')
}

const typeLabels: Record<string, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
}

// ─────────────────────────────────────────────
// View mode (gallery | table)
// ─────────────────────────────────────────────

type ViewMode = 'gallery' | 'list' | 'table'

// ─────────────────────────────────────────────
// Search + filters
// ─────────────────────────────────────────────

const search = ref('')
const drawerOpen = ref(false)

type StatusFilter = 'open' | 'draft' | 'closed' | 'archived'
type TypeFilter = 'full_time' | 'part_time' | 'contract' | 'internship'
type ExperienceFilter = 'junior' | 'mid' | 'senior' | 'lead'
type RemoteFilter = 'remote' | 'hybrid' | 'onsite'

const statusFilter = ref<StatusFilter[]>([])
const typeFilter = ref<TypeFilter[]>([])
const experienceFilter = ref<ExperienceFilter[]>([])
const remoteFilter = ref<RemoteFilter[]>([])

const statusOptions: { value: StatusFilter, label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'draft', label: 'Draft' },
  { value: 'closed', label: 'Closed' },
  { value: 'archived', label: 'Archived' },
]
const typeOptions: { value: TypeFilter, label: string }[] = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
]
const experienceOptions: { value: ExperienceFilter, label: string }[] = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
]
const remoteOptions: { value: RemoteFilter, label: string }[] = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
]

function toggleIn<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value]
}

function toggleStatus(v: StatusFilter) { statusFilter.value = toggleIn(statusFilter.value, v) }
function toggleType(v: TypeFilter) { typeFilter.value = toggleIn(typeFilter.value, v) }
function toggleExperience(v: ExperienceFilter) { experienceFilter.value = toggleIn(experienceFilter.value, v) }
function toggleRemote(v: RemoteFilter) { remoteFilter.value = toggleIn(remoteFilter.value, v) }

const activeFilterCount = computed(() =>
  statusFilter.value.length
  + typeFilter.value.length
  + experienceFilter.value.length
  + remoteFilter.value.length,
)

function clearFilters() {
  statusFilter.value = []
  typeFilter.value = []
  experienceFilter.value = []
  remoteFilter.value = []
}

const filteredJobs = computed(() => {
  const q = search.value.trim().toLowerCase()
  return jobs.value.filter((j: any) => {
    if (q) {
      const hay = `${j.title ?? ''} ${j.location ?? ''} ${j.description ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (statusFilter.value.length && !statusFilter.value.includes(j.status)) return false
    if (typeFilter.value.length && !typeFilter.value.includes(j.type)) return false
    if (experienceFilter.value.length) {
      if (!j.experienceLevel || !experienceFilter.value.includes(j.experienceLevel)) return false
    }
    if (remoteFilter.value.length) {
      if (!j.remoteStatus || !remoteFilter.value.includes(j.remoteStatus)) return false
    }
    return true
  })
})

// ─────────────────────────────────────────────
// Table sort
// ─────────────────────────────────────────────

type SortKey = 'title' | 'status' | 'type' | 'location' | 'new' | 'active' | 'created'
type SortDir = 'asc' | 'desc'

const sortKey = ref<SortKey>('created')
const sortDir = ref<SortDir>('desc')

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  }
  else {
    sortKey.value = key
    sortDir.value = key === 'created' || key === 'new' || key === 'active' ? 'desc' : 'asc'
  }
}

// ─────────────────────────────────────────────
// Sort jobs by urgency (gallery) or column (table)
// ─────────────────────────────────────────────

const statusPriority: Record<string, number> = {
  open: 0,
  draft: 1,
  closed: 2,
  archived: 3,
}

function totalActive(pipeline: any) {
  return (pipeline?.new ?? 0) + (pipeline?.screening ?? 0) + (pipeline?.interview ?? 0) + (pipeline?.offer ?? 0) + (pipeline?.hired ?? 0)
}

const sortedJobs = computed(() => {
  const list = [...filteredJobs.value]
  if (sortKey.value !== 'created' || sortDir.value !== 'desc') {
    // Table-style sort
    const dir = sortDir.value === 'asc' ? 1 : -1
    list.sort((a, b) => {
      switch (sortKey.value) {
        case 'title': return dir * (a.title ?? '').localeCompare(b.title ?? '')
        case 'status': return dir * (statusPriority[a.status] ?? 9) - dir * (statusPriority[b.status] ?? 9)
        case 'type': return dir * (a.type ?? '').localeCompare(b.type ?? '')
        case 'location': return dir * (a.location ?? '').localeCompare(b.location ?? '')
        case 'new': return dir * ((a.pipeline?.new ?? 0) - (b.pipeline?.new ?? 0))
        case 'active': return dir * (totalActive(a.pipeline) - totalActive(b.pipeline))
        case 'created': return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        default: return 0
      }
    })
    return list
  }

  // Default gallery urgency sort
  list.sort((a, b) => {
    const aPriority = statusPriority[a.status] ?? 9
    const bPriority = statusPriority[b.status] ?? 9
    if (aPriority !== bPriority) return aPriority - bPriority
    const aNew = a.pipeline?.new ?? 0
    const bNew = b.pipeline?.new ?? 0
    if (aNew !== bNew) return bNew - aNew
    const aActive = totalActive(a.pipeline)
    const bActive = totalActive(b.pipeline)
    if (aActive !== bActive) return bActive - aActive
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
  return list
})

// ─────────────────────────────────────────────
// Group jobs: needs attention + others (gallery only)
// ─────────────────────────────────────────────

const jobsNeedingAttention = computed(() =>
  sortedJobs.value.filter(j => j.status === 'open' && (j.pipeline?.new ?? 0) > 0),
)

const otherJobs = computed(() =>
  sortedJobs.value.filter(j => !(j.status === 'open' && (j.pipeline?.new ?? 0) > 0)),
)

// ─────────────────────────────────────────────
// Saved views
// ─────────────────────────────────────────────

type JobsViewSettings = {
  statusFilter: StatusFilter[]
  typeFilter: TypeFilter[]
  experienceFilter: ExperienceFilter[]
  remoteFilter: RemoteFilter[]
  viewMode: ViewMode
  sortKey: SortKey
  sortDir: SortDir
}

const defaultSettings: JobsViewSettings = {
  statusFilter: [],
  typeFilter: [],
  experienceFilter: [],
  remoteFilter: [],
  viewMode: 'gallery',
  sortKey: 'created',
  sortDir: 'desc',
}

const viewMode = ref<ViewMode>('gallery')

const currentSettings = computed<JobsViewSettings>(() => ({
  statusFilter: [...statusFilter.value],
  typeFilter: [...typeFilter.value],
  experienceFilter: [...experienceFilter.value],
  remoteFilter: [...remoteFilter.value],
  viewMode: viewMode.value,
  sortKey: sortKey.value,
  sortDir: sortDir.value,
}))

function applySettings(s: JobsViewSettings) {
  statusFilter.value = [...(s.statusFilter ?? [])]
  typeFilter.value = [...(s.typeFilter ?? [])]
  experienceFilter.value = [...(s.experienceFilter ?? [])]
  remoteFilter.value = [...(s.remoteFilter ?? [])]
  viewMode.value = s.viewMode ?? 'gallery'
  sortKey.value = s.sortKey ?? 'created'
  sortDir.value = s.sortDir ?? 'desc'
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
} = useSavedViews<JobsViewSettings>('jobs', defaultSettings)

onMounted(() => {
  nextTick(() => {
    if (activeViewId.value) {
      const s = applyView(activeViewId.value)
      if (s) applySettings(s)
    }
  })
})

function settingsEqual(a: JobsViewSettings, b: JobsViewSettings) {
  return a.viewMode === b.viewMode
    && a.sortKey === b.sortKey
    && a.sortDir === b.sortDir
    && JSON.stringify(a.statusFilter ?? []) === JSON.stringify(b.statusFilter ?? [])
    && JSON.stringify(a.typeFilter ?? []) === JSON.stringify(b.typeFilter ?? [])
    && JSON.stringify(a.experienceFilter ?? []) === JSON.stringify(b.experienceFilter ?? [])
    && JSON.stringify(a.remoteFilter ?? []) === JSON.stringify(b.remoteFilter ?? [])
}

const isDirty = computed(() => {
  const view = views.value.find(v => v.id === activeViewId.value)
  if (!view) return false
  return !settingsEqual(currentSettings.value, { ...defaultSettings, ...view.settings })
})

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

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const isEmpty = computed(() => jobs.value.length === 0)
const noResults = computed(() => !isEmpty.value && filteredJobs.value.length === 0)

// Sort options for UiSelect inside FilterDrawer
const sortKeyOptions = computed(() => [
  { value: 'created', label: t('dashboard.jobs.sort.dateCreated') },
  { value: 'title', label: t('dashboard.jobs.sort.title') },
  { value: 'status', label: t('dashboard.jobs.sort.status') },
  { value: 'type', label: t('dashboard.jobs.sort.employmentType') },
  { value: 'location', label: t('dashboard.jobs.sort.location') },
  { value: 'new', label: t('dashboard.jobs.sort.newApplicants') },
  { value: 'active', label: t('dashboard.jobs.sort.activeCandidates') },
])
const sortDirOptions = computed(() => [
  { value: 'asc', label: t('dashboard.jobs.sort.ascending') },
  { value: 'desc', label: t('dashboard.jobs.sort.descending') },
])
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <!-- ─── Header ─── -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">{{ $t('dashboard.jobs.title') }}</h1>
        <p v-if="activeOrg" class="text-sm text-surface-500 dark:text-surface-400 mt-1">
          {{ activeOrg.name }}
        </p>
      </div>
      <UiButton :to="$localePath('/dashboard/jobs/new')" :icon-left="Plus">
        {{ $t('dashboard.jobs.new.createJob') }}
      </UiButton>
    </div>

    <!-- ─── Loading ─── -->
    <div v-if="fetchStatus === 'pending'">
      <div class="space-y-4">
        <div
          v-for="i in 3"
          :key="i"
          class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 animate-pulse"
        >
          <div class="flex items-center justify-between mb-4">
            <div class="h-5 w-48 bg-surface-200 dark:bg-surface-700 rounded" />
            <div class="h-5 w-16 bg-surface-200 dark:bg-surface-700 rounded-full" />
          </div>
          <div class="h-2 w-full bg-surface-200 dark:bg-surface-700 rounded mb-3" />
          <div class="flex gap-4">
            <div class="h-4 w-20 bg-surface-200 dark:bg-surface-700 rounded" />
            <div class="h-4 w-20 bg-surface-200 dark:bg-surface-700 rounded" />
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Error ─── -->
    <UiCard
      v-else-if="error"
      variant="tinted"
      tone="danger"
      radius="md"
      padding="sm"
      class="text-sm text-danger-700 dark:text-danger-400"
    >
      {{ $t('dashboard.jobs.failedToLoad') }}
      <button class="underline ml-1 cursor-pointer" @click="refresh()">{{ $t('dashboard.jobs.retry') }}</button>
    </UiCard>

    <!-- ─── Empty state ─── -->
    <div v-else-if="isEmpty" class="flex flex-col items-center justify-center py-20">
      <UiCard padding="lg" class="text-center max-w-md">
        <Briefcase class="size-12 text-brand-400 mx-auto mb-4" />
        <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2">
          {{ $t('dashboard.jobs.welcomeTitle') }}
        </h2>
        <p class="text-sm text-surface-500 dark:text-surface-400 mb-6 leading-relaxed">
          {{ $t('dashboard.jobs.welcomeDesc') }}
        </p>
        <UiButton :to="$localePath('/dashboard/jobs/new')" :icon-left="Plus">
          {{ $t('dashboard.jobs.createFirst') }}
        </UiButton>
      </UiCard>
    </div>

    <!-- ─── Jobs content ─── -->
    <template v-else>
      <!-- ─── Toolbar: Search + Views + Filters + View Toggle ─── -->
      <div class="flex items-center gap-2 mb-4">
        <div class="flex-1">
          <UiInput
            v-model="search"
            type="search"
            :placeholder="$t('dashboard.jobs.searchPlaceholder')"
            :icon-left="Search"
          />
        </div>

        <!-- Saved views menu -->
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

        <!-- View mode toggle -->
        <div class="inline-flex rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors"
            :class="viewMode === 'gallery'
              ? 'bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100'
              : 'text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'"
            title="Gallery view"
            @click="viewMode = 'gallery'"
          >
            <LayoutGrid class="size-4" />
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-l border-surface-200 dark:border-surface-800"
            :class="viewMode === 'list'
              ? 'bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100'
              : 'text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'"
            title="List view"
            @click="viewMode = 'list'"
          >
            <List class="size-4" />
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-l border-surface-200 dark:border-surface-800"
            :class="viewMode === 'table'
              ? 'bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100'
              : 'text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'"
            title="Table view"
            @click="viewMode = 'table'"
          >
            <Table2 class="size-4" />
          </button>
        </div>

        <!-- Filters button -->
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors cursor-pointer"
          :class="activeFilterCount > 0
            ? 'border-surface-400 bg-surface-100 text-surface-800 dark:border-surface-500 dark:bg-surface-800 dark:text-surface-200'
            : 'border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'"
          @click="drawerOpen = true"
        >
          <SlidersHorizontal class="size-4" />
          {{ $t('dashboard.jobs.filters') }}
          <UiBadge v-if="activeFilterCount > 0" variant="solid" tone="neutral" size="sm">
            {{ activeFilterCount }}
          </UiBadge>
        </button>

        <!-- Clear filters -->
        <button
          v-if="activeFilterCount > 0"
          class="inline-flex items-center gap-1 text-xs text-surface-400 hover:text-danger-600 transition-colors"
          @click="clearFilters"
        >
          <X class="size-3" />
          Clear
        </button>
      </div>

      <!-- ─── Filter Drawer ─── -->
      <FilterDrawer
        v-model="drawerOpen"
        title="Filter jobs"
        description="Customize your view, then save it for quick access."
        :active-count="activeFilterCount"
        saveable
        :default-save-name="`View ${views.length + 1}`"
        @reset="applySettings(defaultSettings)"
        @save-view="onSaveView"
      >
        <div class="space-y-6">
          <!-- Status -->
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">{{ $t('dashboard.jobs.filter.status') }}</label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="opt in statusOptions"
                :key="opt.value"
                type="button"
                class="rounded-full px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer"
                :class="statusFilter.includes(opt.value)
                  ? 'border-brand-300 bg-brand-100 text-brand-700 dark:border-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                  : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'"
                @click="toggleStatus(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Employment type -->
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">{{ $t('dashboard.jobs.filter.employmentType') }}</label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="opt in typeOptions"
                :key="opt.value"
                type="button"
                class="rounded-full px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer"
                :class="typeFilter.includes(opt.value)
                  ? 'border-brand-300 bg-brand-100 text-brand-700 dark:border-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                  : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'"
                @click="toggleType(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Experience level -->
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">{{ $t('dashboard.jobs.filter.experienceLevel') }}</label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="opt in experienceOptions"
                :key="opt.value"
                type="button"
                class="rounded-full px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer"
                :class="experienceFilter.includes(opt.value)
                  ? 'border-brand-300 bg-brand-100 text-brand-700 dark:border-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                  : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'"
                @click="toggleExperience(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Work arrangement -->
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">{{ $t('dashboard.jobs.filter.workArrangement') }}</label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="opt in remoteOptions"
                :key="opt.value"
                type="button"
                class="rounded-full px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer"
                :class="remoteFilter.includes(opt.value)
                  ? 'border-brand-300 bg-brand-100 text-brand-700 dark:border-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                  : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'"
                @click="toggleRemote(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Sort -->
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">{{ $t('dashboard.jobs.filter.sortBy') }}</label>
            <div class="flex gap-2">
              <UiSelect v-model="sortKey" :options="sortKeyOptions" />
              <UiSelect v-model="sortDir" :options="sortDirOptions" :block="false" class="w-32" />
            </div>
          </div>
        </div>
      </FilterDrawer>

      <!-- ─── No-results state ─── -->
      <UiCard
        v-if="noResults"
        variant="dashed"
        padding="lg"
        class="text-center"
      >
        <Search class="size-8 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
        <p class="text-sm text-surface-600 dark:text-surface-300 mb-1">{{ $t('dashboard.jobs.noResults') }}</p>
        <p class="text-xs text-surface-400 dark:text-surface-500">{{ $t('dashboard.jobs.noResultsHint') }}</p>
      </UiCard>

      <!-- ═══════════════════════════════════
           TABLE VIEW
      ════════════════════════════════════ -->
      <template v-else-if="viewMode === 'table'">
        <div class="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-800">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-800">
                <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">
                  <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('title')">
                    Title
                    <ArrowUp v-if="sortKey === 'title' && sortDir === 'asc'" class="size-3.5" />
                    <ArrowDown v-else-if="sortKey === 'title' && sortDir === 'desc'" class="size-3.5" />
                    <ArrowUpDown v-else class="size-3.5 opacity-40" />
                  </button>
                </th>
                <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">
                  <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('status')">
                    Status
                    <ArrowUp v-if="sortKey === 'status' && sortDir === 'asc'" class="size-3.5" />
                    <ArrowDown v-else-if="sortKey === 'status' && sortDir === 'desc'" class="size-3.5" />
                    <ArrowUpDown v-else class="size-3.5 opacity-40" />
                  </button>
                </th>
                <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden sm:table-cell">
                  <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('type')">
                    Type
                    <ArrowUp v-if="sortKey === 'type' && sortDir === 'asc'" class="size-3.5" />
                    <ArrowDown v-else-if="sortKey === 'type' && sortDir === 'desc'" class="size-3.5" />
                    <ArrowUpDown v-else class="size-3.5 opacity-40" />
                  </button>
                </th>
                <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden md:table-cell">
                  <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('location')">
                    Location
                    <ArrowUp v-if="sortKey === 'location' && sortDir === 'asc'" class="size-3.5" />
                    <ArrowDown v-else-if="sortKey === 'location' && sortDir === 'desc'" class="size-3.5" />
                    <ArrowUpDown v-else class="size-3.5 opacity-40" />
                  </button>
                </th>
                <th class="text-center px-4 py-3 font-medium text-surface-500 dark:text-surface-400">
                  <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('new')">
                    New
                    <ArrowUp v-if="sortKey === 'new' && sortDir === 'asc'" class="size-3.5" />
                    <ArrowDown v-else-if="sortKey === 'new' && sortDir === 'desc'" class="size-3.5" />
                    <ArrowUpDown v-else class="size-3.5 opacity-40" />
                  </button>
                </th>
                <th class="text-center px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden sm:table-cell">
                  <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('active')">
                    Active
                    <ArrowUp v-if="sortKey === 'active' && sortDir === 'asc'" class="size-3.5" />
                    <ArrowDown v-else-if="sortKey === 'active' && sortDir === 'desc'" class="size-3.5" />
                    <ArrowUpDown v-else class="size-3.5 opacity-40" />
                  </button>
                </th>
                <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden lg:table-cell">
                  <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('created')">
                    Created
                    <ArrowUp v-if="sortKey === 'created' && sortDir === 'asc'" class="size-3.5" />
                    <ArrowDown v-else-if="sortKey === 'created' && sortDir === 'desc'" class="size-3.5" />
                    <ArrowUpDown v-else class="size-3.5 opacity-40" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
              <tr
                v-for="j in sortedJobs"
                :key="j.id"
                class="group bg-white dark:bg-surface-900 hover:bg-surface-50 dark:hover:bg-surface-800/60 transition-colors cursor-pointer"
                @click="$router.push(localePath(`/dashboard/jobs/${j.id}`))"
              >
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <NuxtLink
                      :to="localePath(`/dashboard/jobs/${j.id}`)"
                      class="font-semibold text-surface-900 dark:text-surface-100 group-hover:text-brand-600 transition-colors truncate max-w-[200px] no-underline"
                      @click.stop
                    >
                      {{ j.title }}
                    </NuxtLink>
                    <UiBadge v-if="(j.pipeline?.new ?? 0) > 0" tone="warning">
                      {{ j.pipeline.new }} new
                    </UiBadge>
                    <UiBadge
                      v-if="j.hhLinked"
                      tone="danger"
                      :title="`Связано с hh.ru · #${j.hhVacancyId} · ${j.hhImportedCount} откликов`"
                    >hh</UiBadge>
                  </div>
                </td>
                <td class="px-4 py-3">
                  <UiBadge :tone="statusTone(j.status)" class="capitalize">{{ j.status }}</UiBadge>
                </td>
                <td class="px-4 py-3 text-surface-500 dark:text-surface-400 hidden sm:table-cell whitespace-nowrap">
                  {{ typeLabels[j.type] ?? j.type }}
                </td>
                <td class="px-4 py-3 text-surface-500 dark:text-surface-400 hidden md:table-cell">
                  <span v-if="j.location" class="inline-flex items-center gap-1">
                    <MapPin class="size-3 shrink-0" />
                    {{ j.location }}
                  </span>
                  <span v-else class="text-surface-300 dark:text-surface-600">—</span>
                </td>
                <td class="px-4 py-3 text-center">
                  <span
                    v-if="(j.pipeline?.new ?? 0) > 0"
                    class="inline-flex items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400 tabular-nums"
                  >
                    {{ j.pipeline.new }}
                  </span>
                  <span v-else class="text-surface-300 dark:text-surface-600">0</span>
                </td>
                <td class="px-4 py-3 text-center hidden sm:table-cell">
                  <span
                    v-if="totalActive(j.pipeline) > 0"
                    class="inline-flex items-center justify-center rounded-full bg-brand-50 dark:bg-brand-950 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-400 tabular-nums"
                  >
                    {{ totalActive(j.pipeline) }}
                  </span>
                  <span v-else class="text-surface-300 dark:text-surface-600">0</span>
                </td>
                <td class="px-4 py-3 text-surface-500 dark:text-surface-400 whitespace-nowrap hidden lg:table-cell">
                  {{ new Date(j.createdAt).toLocaleDateString() }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ═══════════════════════════════════
           GALLERY VIEW (grid)
      ════════════════════════════════════ -->
      <template v-else-if="viewMode === 'gallery'">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <NuxtLink
            v-for="j in sortedJobs"
            :key="j.id"
            :to="localePath(`/dashboard/jobs/${j.id}`)"
            class="group rounded-xl border bg-white dark:bg-surface-900 p-4 flex flex-col gap-3 hover:shadow-md transition-all no-underline"
            :class="(j.pipeline?.new ?? 0) > 0
              ? 'border-warning-200 dark:border-warning-900/60 hover:border-warning-300 dark:hover:border-warning-800'
              : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700'"
          >
            <!-- Card header: title + status -->
            <div class="flex items-start justify-between gap-2">
              <span class="font-semibold text-sm text-surface-900 dark:text-surface-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors line-clamp-2 leading-snug">
                {{ j.title }}
              </span>
              <div class="flex items-center gap-1.5 shrink-0">
                <UiBadge
                  v-if="j.hhLinked"
                  tone="danger"
                  :title="`Связано с hh.ru · #${j.hhVacancyId} · ${j.hhImportedCount} откликов`"
                >hh</UiBadge>
                <UiBadge :tone="statusTone(j.status)" class="capitalize mt-0.5">{{ j.status }}</UiBadge>
              </div>
            </div>

            <!-- Meta: type + location -->
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-400 dark:text-surface-500">
              <span>{{ typeLabels[j.type] ?? j.type }}</span>
              <span v-if="j.location" class="inline-flex items-center gap-1">
                <MapPin class="size-3 shrink-0" />
                {{ j.location }}
              </span>
            </div>

            <!-- Pipeline mini-stats -->
            <div class="grid grid-cols-3 gap-1.5 mt-auto">
              <NuxtLink
                v-for="stage in stageConfig"
                :key="stage.key"
                :to="localePath(`/dashboard/jobs/${j.id}?stage=${stage.key}`)"
                class="rounded-lg px-1.5 py-1 text-center transition-colors no-underline hover:ring-1 hover:ring-brand-300 dark:hover:ring-brand-700"
                :class="[stage.bgColor, getStageCount(j.pipeline, stage.key) > 0 ? 'cursor-pointer' : 'opacity-50']"
                @click.stop
              >
                <div class="text-xs font-bold tabular-nums" :class="stage.textColor">
                  {{ getStageCount(j.pipeline, stage.key) }}
                </div>
                <div class="text-[9px] font-medium text-surface-500 dark:text-surface-400 leading-tight">
                  {{ stage.label }}
                </div>
              </NuxtLink>
            </div>

            <!-- Attention bar -->
            <div
              v-if="(j.pipeline?.new ?? 0) > 0"
              class="flex items-center justify-between gap-2 -mx-4 -mb-4 px-4 py-2 rounded-b-xl bg-warning-50/60 dark:bg-warning-950/30 border-t border-warning-100 dark:border-warning-900/30"
            >
              <span class="text-xs font-medium text-warning-700 dark:text-warning-400">
                {{ j.pipeline.new }} new application{{ j.pipeline.new === 1 ? '' : 's' }}
              </span>
              <span class="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 font-medium">
                <Kanban class="size-3" />
                {{ $t('dashboard.common.view_details') }}
              </span>
            </div>
          </NuxtLink>
        </div>
      </template>

      <!-- ═══════════════════════════════════
           LIST VIEW
      ════════════════════════════════════ -->
      <template v-else-if="viewMode === 'list'">
        <!-- ─── Needs attention section ─── -->
        <div v-if="jobsNeedingAttention.length > 0" class="mb-8">
          <div class="flex items-center gap-2 mb-3 px-1">
            <Bell class="size-4 text-warning-500" />
            <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">
              {{ $t('dashboard.jobs.attention.needsYourAttention') }}
            </h2>
            <span class="text-xs text-surface-400 dark:text-surface-500">
              {{ jobsNeedingAttention.length }} job{{ jobsNeedingAttention.length === 1 ? '' : 's' }}
            </span>
          </div>

          <div class="space-y-3">
            <div
              v-for="j in jobsNeedingAttention"
              :key="j.id"
              class="rounded-xl border border-warning-200 dark:border-warning-900/50 bg-white dark:bg-surface-900 overflow-hidden"
            >
              <!-- Card header — job info -->
              <div class="px-5 pt-4 pb-3">
                <div class="flex items-start justify-between mb-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2.5 mb-1">
                      <NuxtLink
                        :to="localePath(`/dashboard/jobs/${j.id}`)"
                        class="text-base font-semibold text-surface-900 dark:text-surface-100 hover:text-brand-600 dark:hover:text-brand-400 transition-colors truncate no-underline"
                      >
                        {{ j.title }}
                      </NuxtLink>
                      <UiBadge :tone="statusTone(j.status)" class="capitalize shrink-0">{{ j.status }}</UiBadge>
                    </div>
                    <div class="flex items-center gap-3 text-xs text-surface-400">
                      <span>{{ typeLabels[j.type] ?? j.type }}</span>
                      <span v-if="j.location" class="inline-flex items-center gap-1">
                        <MapPin class="size-3" />
                        {{ j.location }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Stage counts -->
                <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
                  <NuxtLink
                    v-for="stage in stageConfig"
                    :key="stage.key"
                    :to="localePath(`/dashboard/jobs/${j.id}?stage=${stage.key}`)"
                    class="rounded-lg px-2 py-1.5 text-center transition-colors no-underline hover:ring-1 hover:ring-brand-300 dark:hover:ring-brand-700"
                    :class="[stage.bgColor, getStageCount(j.pipeline, stage.key) > 0 ? 'cursor-pointer' : 'opacity-60']"
                  >
                    <div class="text-sm font-bold tabular-nums" :class="stage.textColor">
                      {{ getStageCount(j.pipeline, stage.key) }}
                    </div>
                    <div class="text-[10px] font-medium text-surface-500 dark:text-surface-400">
                      {{ stage.label }}
                    </div>
                  </NuxtLink>
                </div>
              </div>

              <!-- Action bar -->
              <div class="flex items-center gap-2 px-5 py-3 bg-warning-50/50 dark:bg-warning-950/20 border-t border-warning-100 dark:border-warning-900/30">
                <span class="text-xs font-medium text-warning-700 dark:text-warning-400 mr-auto">
                  {{ j.pipeline.new }} new application{{ j.pipeline.new === 1 ? '' : 's' }} to review
                </span>
                <UiButton
                  :to="$localePath(`/dashboard/jobs/${j.id}`)"
                  size="xs"
                  :icon-left="Kanban"
                >
                  {{ $t('dashboard.jobs.actions.reviewInPipeline') }}
                </UiButton>
              </div>
            </div>
          </div>
        </div>

        <!-- ─── All other jobs ─── -->
        <div>
          <div v-if="jobsNeedingAttention.length > 0" class="flex items-center gap-2 mb-3 px-1">
            <Briefcase class="size-4 text-surface-400" />
            <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">
              {{ $t('dashboard.jobs.allJobs') }}
            </h2>
            <span class="text-xs text-surface-400 dark:text-surface-500">
              {{ otherJobs.length }} job{{ otherJobs.length === 1 ? '' : 's' }}
            </span>
          </div>

          <div class="space-y-3">
            <div
              v-for="j in otherJobs"
              :key="j.id"
              class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-5 py-4 hover:border-surface-300 dark:hover:border-surface-700 hover:shadow-sm transition-all"
            >
              <!-- Job info -->
              <div class="flex items-center gap-2.5 mb-1">
                <NuxtLink
                  :to="localePath(`/dashboard/jobs/${j.id}`)"
                  class="text-sm font-semibold text-surface-900 dark:text-surface-100 hover:text-brand-600 dark:hover:text-brand-400 transition-colors truncate no-underline"
                >
                  {{ j.title }}
                </NuxtLink>
                <UiBadge :tone="statusTone(j.status)" class="capitalize shrink-0">{{ j.status }}</UiBadge>
              </div>
              <div class="flex items-center gap-3 text-xs text-surface-400 mb-3">
                <span>{{ typeLabels[j.type] ?? j.type }}</span>
                <span v-if="j.location" class="inline-flex items-center gap-1">
                  <MapPin class="size-3" />
                  {{ j.location }}
                </span>
                <span v-if="j.status === 'draft'" class="text-surface-400 italic">
                  {{ $t('dashboard.jobs.notPublishedYet') }}
                </span>
              </div>

              <!-- Stage counts -->
              <div class="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <NuxtLink
                  v-for="stage in stageConfig"
                  :key="stage.key"
                  :to="localePath(`/dashboard/jobs/${j.id}?stage=${stage.key}`)"
                  class="rounded-lg px-2 py-1.5 text-center transition-colors no-underline hover:ring-1 hover:ring-brand-300 dark:hover:ring-brand-700"
                  :class="[stage.bgColor, getStageCount(j.pipeline, stage.key) > 0 ? 'cursor-pointer' : 'opacity-60']"
                >
                  <div class="text-sm font-bold tabular-nums" :class="stage.textColor">
                    {{ getStageCount(j.pipeline, stage.key) }}
                  </div>
                  <div class="text-[10px] font-medium text-surface-500 dark:text-surface-400">
                    {{ stage.label }}
                  </div>
                </NuxtLink>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Total count -->
      <p v-if="!noResults" class="text-xs text-surface-400 pt-4 px-1">
        <template v-if="search || activeFilterCount > 0">
          Showing {{ filteredJobs.length }} of {{ total }} job{{ total === 1 ? '' : 's' }}
        </template>
        <template v-else>
          {{ total }} job{{ total === 1 ? '' : 's' }} total
        </template>
      </p>
    </template>
  </div>
</template>
