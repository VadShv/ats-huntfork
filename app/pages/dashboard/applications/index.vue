<script setup lang="ts">
import { FileText, Search, X, Briefcase, Mail, Clock, ArrowUp, ArrowDown, ArrowUpDown, SlidersHorizontal, Maximize2, Minimize2, Check, ChevronDown, Loader2 } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Отклики',
  description: 'Управляйте откликами по всем вакансиям',
})

// ── Column visibility ─────────────────────────────────────────────────────────

const COLUMNS_STORAGE_KEY = 'reqcore:columns:applications'

const defaultColumnVisibility = {
  email: true,
  job: true,
  stage: true,
  status: true,
  score: true,
  source: true,
  applied: true,
}

const visibleColumns = ref<Record<string, boolean>>({ ...defaultColumnVisibility })

const { definitions: propertyDefs } = useProperties({ entityType: () => 'application' })

const applicationColumns = computed(() => [
  { key: 'candidate', label: 'Кандидат', required: true },
  { key: 'email', label: 'Email' },
  { key: 'job', label: 'Вакансия' },
  { key: 'stage', label: t('applications.stage.label') },
  { key: 'status', label: t('applications.state.label') },
  { key: 'score', label: 'Балл' },
  { key: 'source', label: 'Источник' },
  { key: 'applied', label: 'Откликнулся' },
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

// ── Stage filter (Фаза 1: единый словарь — этапы воронки, мультиселект) ───────

const propertyFilters = ref<import('~~/shared/properties').PropertyFilter[]>([])

/** Легаси-маппинг старых URL ?status= → типы корневых этапов (back-compat старых ссылок/закладок). */
const LEGACY_STATUS_TO_TYPES: Record<string, string[]> = {
  new: ['new', 'applied'],
  screening: ['on_hold', 'contact', 'assessment', 'screening'],
  interview: ['interview'],
  offer: ['offer'],
  hired: ['hired'],
  rejected: ['rejected', 'not_fit', 'withdrawn', 'no_show', 'job_closed', 'transferred'],
}

function parseStageParam(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  return [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))]
}

const initialStageIds = parseStageParam(route.query.stage)
// Back-compat: старый одиночный ?stageId= подхватываем как выбор из одного этапа
if (initialStageIds.length === 0 && typeof route.query.stageId === 'string' && route.query.stageId) {
  initialStageIds.push(route.query.stageId)
}
const activeStageIds = useState<string[]>('app-filter-stageIds', () => initialStageIds)
if (initialStageIds.length > 0) {
  activeStageIds.value = initialStageIds
}

// Sync URL: ?stage=id1,id2 (легаси-параметры status/stageId вычищаем)
watch(activeStageIds, (ids) => {
  const query = { ...route.query }
  delete query.status
  delete query.stageId
  if (ids.length > 0) {
    query.stage = ids.join(',')
  }
  else {
    delete query.stage
  }
  router.replace({ query })
}, { deep: true })

function toggleStageChip(id: string) {
  activeStageIds.value = activeStageIds.value.includes(id)
    ? activeStageIds.value.filter(x => x !== id)
    : [...activeStageIds.value, id]
}

// Fetch stages-summary for the stage filter chips
type StageOption = { id: string; name: string; color: string; type: string; bucket: string; parentStageId: string | null; displayOrder: number }
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

// Фаза 1: чипы фильтра — только корневые этапы (подэтапы захватываются сервером автоматически)
const rootStageGroups = computed(() =>
  stageGroups.value
    .map(g => ({ ...g, stages: g.stages.filter(s => !s.parentStageId) }))
    .filter(g => g.stages.length > 0),
)

// Back-compat: старые ссылки ?status=screening и т.п. → выбор соответствующих корневых этапов.
// Ждём загрузку справочника этапов, затем конвертируем и чистим URL.
function legacyStatusToStageIds(status: string): string[] {
  const types = LEGACY_STATUS_TO_TYPES[status]
  if (!types) return []
  return rootStageGroups.value.flatMap(g => g.stages.filter(s => types.includes(s.type)).map(s => s.id))
}

watch(rootStageGroups, (groups) => {
  if (groups.length === 0) return
  const legacyStatus = typeof route.query.status === 'string' ? route.query.status : undefined
  if (legacyStatus && activeStageIds.value.length === 0) {
    const ids = legacyStatusToStageIds(legacyStatus)
    if (ids.length > 0) {
      activeStageIds.value = ids
      return // watch на activeStageIds сам перепишет URL
    }
  }
  if (legacyStatus) {
    // Нераспознанный/лишний легаси-параметр — просто убираем из URL
    const query = { ...route.query }
    delete query.status
    router.replace({ query })
  }
}, { immediate: true })

const { applications, total, fetchStatus, error, refresh } = useApplications({
  stageIds: activeStageIds,
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
        // Фаза 1: сортируем по состоянию (В работе / Нанят / Отказ), а не по легаси-статусу
        return dir * appState(a).localeCompare(appState(b))
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
  activeStageIds.value.length > 0
  || activeJobId.value != null
  || debouncedSearch.value.length > 0
  || propertyFilters.value.length > 0,
)

function clearAllFilters() {
  activeStageIds.value = []
  activeJobId.value = undefined
  searchInput.value = ''
  debouncedSearch.value = ''
  propertyFilters.value = []
}

// ── Sprint 1B: безопасный рендер FTS snippet ──
// Сервер возвращает ts_headline с тегами <mark>...</mark>. Экранируем всё HTML, потом возвращаем только <mark>.
function renderSnippet(snippet: string | null | undefined): string {
  if (!snippet) return ''
  const escaped = snippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  return escaped
    .replace(/&lt;mark&gt;/g, '<mark class="bg-yellow-200 dark:bg-yellow-700/40 text-surface-900 dark:text-surface-100 px-0.5 rounded-sm">')
    .replace(/&lt;\/mark&gt;/g, '</mark>')
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

// Фаза 1: колонка «Состояние» — производная от bucket/type текущего этапа, без легаси-статуса
type AppState = 'working' | 'hired' | 'rejected'

function appState(raw: unknown): AppState {
  const app = raw as { currentStageBucket?: string | null, currentStageType?: string | null }
  if (app.currentStageBucket === 'rejected') return 'rejected'
  if (app.currentStageType === 'hired') return 'hired'
  return 'working'
}

const stateLabels = computed<Record<AppState, string>>(() => ({
  working: t('applications.state.working'),
  hired: t('applications.state.hired'),
  rejected: t('applications.state.rejected'),
}))

const stateClasses: Record<AppState, string> = {
  working: 'bg-surface-100 text-surface-600 ring-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:ring-surface-700',
  hired: 'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950 dark:text-success-400 dark:ring-success-800',
  rejected: 'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-950 dark:text-danger-400 dark:ring-danger-800',
}

// ── Drawer + Saved Views ──────────────────────────────────────────────────────

type ApplicationsViewSettings = {
  /** Легаси-поля старых сохранённых видов — мигрируются на лету в stageIds в applySettings */
  status?: string
  stageId?: string
  stageIds?: string[]
  jobId?: string
  propertyFilters: import('~~/shared/properties').PropertyFilter[]
  sortKey: SortKey
  sortDir: SortDir
  visibleColumns?: Record<string, boolean>
}

const defaultSettings: ApplicationsViewSettings = {
  stageIds: undefined,
  jobId: undefined,
  propertyFilters: [],
  sortKey: 'created',
  sortDir: 'desc',
  visibleColumns: undefined,
}

const drawerOpen = ref(false)
const isFullscreen = ref(false)
const currentSettings = computed<ApplicationsViewSettings>(() => ({
  stageIds: activeStageIds.value.length > 0 ? [...activeStageIds.value] : undefined,
  jobId: activeJobId.value,
  propertyFilters: [...propertyFilters.value],
  sortKey: sortKey.value,
  sortDir: sortDir.value,
  visibleColumns: { ...visibleColumns.value },
}))

function applySettings(s: ApplicationsViewSettings) {
  // Миграция старых сохранённых видов: status → этапы по типу, stageId → [stageId]
  if (s.stageIds && s.stageIds.length > 0) {
    activeStageIds.value = [...s.stageIds]
  }
  else if (s.stageId) {
    activeStageIds.value = [s.stageId]
  }
  else if (s.status) {
    activeStageIds.value = legacyStatusToStageIds(s.status)
  }
  else {
    activeStageIds.value = []
  }
  activeJobId.value = s.jobId
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

/** Нормализация набора этапов вида с учётом легаси-полей (status/stageId старых видов) */
function viewStageIds(s: ApplicationsViewSettings): string[] {
  if (s.stageIds && s.stageIds.length > 0) return s.stageIds
  if (s.stageId) return [s.stageId]
  if (s.status) return legacyStatusToStageIds(s.status)
  return []
}

function settingsEqual(a: ApplicationsViewSettings, b: ApplicationsViewSettings) {
  return JSON.stringify([...viewStageIds(a)].sort()) === JSON.stringify([...viewStageIds(b)].sort())
    && a.jobId === b.jobId
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
  (activeStageIds.value.length > 0 ? 1 : 0)
  + (activeJobId.value ? 1 : 0)
  + propertyFilters.value.length,
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

// Аудит синхронизации (Б-1): массовое отклонение через ЭТАП воронки.
// Этап «Отказ» резолвим один раз на вакансию (у откликов одной вакансии — одна воронка).
type RejectStageLite = {
  id: string
  type: string
  bucket: string | null
  isTerminal: boolean
  isArchived: boolean
  isHidden: boolean
  parentStageId: string | null
}

function resolveRejectStageId(stages: RejectStageLite[]): string | null {
  // Спринт 22: «Не подходит» — подэтап родителя «Отказ»; родитель с подэтапами
  // напрямую не выбирается (сервер вернёт 422 CHOOSE_SUBSTAGE).
  const active = stages.filter(s => !s.isArchived && !s.isHidden)
  const hasChildren = (id: string) => active.some(c => c.parentStageId === id)
  const notFit = active.filter(s => s.type === 'not_fit')
  const pick = notFit.find(s => s.parentStageId) ?? notFit.find(s => !s.parentStageId && !hasChildren(s.id))
  if (pick) return pick.id
  const rejectedSub = active.find(s => s.bucket === 'rejected' && s.parentStageId)
  if (rejectedSub) return rejectedSub.id
  const rejectedRoot = active.find(s => s.bucket === 'rejected' && !s.parentStageId && !hasChildren(s.id))
  if (rejectedRoot) return rejectedRoot.id
  const terminal = active.find(s => !s.parentStageId && s.isTerminal && s.type !== 'hired' && !hasChildren(s.id))
  return terminal?.id ?? null
}

async function bulkReject() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  isBulkOperating.value = true

  const rowById = new Map(filteredApplications.value.map(a => [a.id, a]))
  // Резолвим целевой этап отказа по каждой затронутой вакансии
  type JobTarget = { hasPipeline: boolean; stageId: string | null }
  const targetByJob = new Map<string, JobTarget | null>()
  for (const id of ids) {
    const row = rowById.get(id)
    if (!row || targetByJob.has(row.jobId)) continue
    try {
      const stages = await $fetch<RejectStageLite[]>(`/api/applications/${id}/stages`, { headers: useRequestHeaders(['cookie']) })
      targetByJob.set(row.jobId, { hasPipeline: stages.length > 0, stageId: resolveRejectStageId(stages) })
    } catch {
      targetByJob.set(row.jobId, null)
    }
  }

  const results = await Promise.allSettled(
    ids.map((id) => {
      const row = rowById.get(id)
      const target = row ? targetByJob.get(row.jobId) : null
      if (!target) return Promise.reject(new Error('Не удалось определить воронку вакансии'))
      if (target.hasPipeline && target.stageId) {
        return $fetch(`/api/applications/${id}/stage`, { method: 'PATCH', body: { stageId: target.stageId }, headers: useRequestHeaders(['cookie']) })
      }
      if (!target.hasPipeline) {
        // Фолбэк: вакансия без воронки — легаси-статус
        return $fetch(`/api/applications/${id}`, { method: 'PATCH', body: { status: 'rejected' }, headers: useRequestHeaders(['cookie']) })
      }
      return Promise.reject(new Error('В воронке вакансии нет этапа отказа'))
    })
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

// Аудит синхронизации (Н-4): выбор этапа типа «интервью» в пикере предлагает запланировать интервью
const interviewTarget = ref<{ id: string; candidateName: string; jobTitle: string } | null>(null)

function openInterviewSidebar(applicationId: string) {
  const row = filteredApplications.value.find(a => a.id === applicationId)
  if (!row) return
  interviewTarget.value = {
    id: row.id,
    candidateName: formatPersonName(row.candidateFirstName, row.candidateLastName),
    jobTitle: row.jobTitle ?? '',
  }
}

async function handleInterviewScheduled() {
  interviewTarget.value = null
  await refresh()
}

type BulkStageOption = { id: string; name: string; color: string; bucket?: string | null; parentStageId?: string | null }
// Аудит синхронизации (Н-5): этапы группируем по воронкам — одноимённые этапы
// разных воронок больше не смешиваются в одном плоском списке.
type BulkPipelineGroup = { pipelineId: string; pipelineName: string; stages: BulkStageOption[] }
const bulkStageGroups = ref<BulkPipelineGroup[]>([])
const bulkStagesLoading = ref(false)

async function loadBulkStages() {
  if (bulkStageGroups.value.length > 0) return
  bulkStagesLoading.value = true
  try {
    const data = await $fetch<BulkPipelineGroup[]>('/api/pipelines/stages-summary', { headers: useRequestHeaders(['cookie']) })
    bulkStageGroups.value = data
  } catch {
    toast.error('Не удалось загрузить этапы')
  } finally {
    bulkStagesLoading.value = false
  }
}

// Спринт 22 (G3): родитель блока отказов с подэтапами — только через выбор причины
function isBulkRejectParent(stage: BulkStageOption, groupStages: BulkStageOption[]): boolean {
  return stage.bucket === 'rejected' && !stage.parentStageId
    && groupStages.some(s => s.parentStageId === stage.id)
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
  const failedResults = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (succeeded > 0) {
    toast.success(`Перенесено в "${stageName}": ${succeeded} из ${ids.length}`)
    selectedIds.value = new Set()
    await refresh()
  }
  if (failedResults.length > 0) {
    // Спринт 22 (G1): возврат из терминального этапа в работу требует комментария
    const needsComment = failedResults.some(r => (r.reason as any)?.data?.data?.code === 'RETURN_TO_WORK_REQUIRES_COMMENT')
    const message = needsComment
      ? 'Среди выбранных есть отклики в отказе или найме — возврат в работу требует комментария. Переведите их по одному из карточки.'
      : 'Часть откликов не перенесена — вероятно, их вакансии используют другую воронку.'
    toast.error(`Ошибка: ${failedResults.length} из ${ids.length}`, { message })
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
          Ведите кандидатов по воронке найма.
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
        Фильтры
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
        Очистить
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-2.5 py-2 text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
        :title="isFullscreen ? 'Выйти из полноэкранного режима' : 'Развернуть таблицу'"
        @click="isFullscreen = !isFullscreen"
      >
        <Maximize2 v-if="!isFullscreen" class="size-4" />
        <Minimize2 v-else class="size-4" />
      </button>
    </div>

    <!-- Filter drawer -->
    <FilterDrawer
      v-model="drawerOpen"
      title="Фильтр откликов"
      description="Настройте представление и сохраните его для быстрого доступа."
      :active-count="drawerActiveCount"
      saveable
      :default-save-name="`Представление ${views.length + 1}`"
      @reset="applySettings(defaultSettings)"
      @save-view="onSaveView"
    >
      <div class="space-y-6">
        <!-- Этапы воронки (Фаза 1: мультиселект корневых этапов, единый словарь) -->
        <div v-if="rootStageGroups.length > 0">
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">
            {{ $t('applications.filter.stage') }}
          </label>
          <div class="space-y-3">
            <div v-for="group in rootStageGroups" :key="group.pipelineId">
              <div v-if="rootStageGroups.length > 1" class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-1.5">
                {{ group.pipelineName }}
              </div>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="stage in group.stages"
                  :key="stage.id"
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="activeStageIds.includes(stage.id)
                    ? 'bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900'
                    : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'"
                  @click="toggleStageChip(stage.id)"
                >
                  <span class="inline-flex size-2 rounded-full shrink-0" :style="{ backgroundColor: stage.color }" />
                  {{ stage.name }}
                </button>
              </div>
            </div>
          </div>
          <div v-if="activeStageIds.length > 0" class="mt-2 flex items-center justify-between">
            <span class="text-xs text-surface-500 dark:text-surface-400">Выбрано этапов: {{ activeStageIds.length }}</span>
            <button
              type="button"
              class="text-xs text-danger-500 hover:text-danger-700 transition-colors cursor-pointer"
              @click="activeStageIds = []"
            >Сбросить</button>
          </div>
        </div>

        <!-- Job -->
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Вакансия</label>
          <select
            v-model="activeJobId"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          >
            <option :value="undefined">Все вакансии</option>
            <option v-for="j in uniqueJobs" :key="j.id" :value="j.id">{{ j.title }}</option>
          </select>
        </div>

        <!-- Sort -->
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Сортировка</label>
          <div class="flex gap-2">
            <select
              v-model="sortKey"
              class="flex-1 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            >
              <option value="created">Дата отклика</option>
              <option value="name">Кандидат</option>
              <option value="email">Email</option>
              <option value="job">Вакансия</option>
              <option value="status">{{ t('applications.state.label') }}</option>
              <option value="score">Балл</option>
            </select>
            <select
              v-model="sortDir"
              class="w-32 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            >
              <option value="asc">По возрастанию</option>
              <option value="desc">По убыванию</option>
            </select>
          </div>
        </div>

        <!-- Property filters -->
        <div v-if="propertyDefs.length > 0">
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Свойства</label>
          <PropertyFilterBar v-model="propertyFilters" entity-type="application" />
        </div>

        <!-- Columns -->
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Колонки</label>
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
            <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">{{ $t('dashboard.applications.table.state') }}</th>
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
        Отклики появятся здесь, когда кандидаты откликнутся на ваши вакансии или когда вы привяжете их вручную.
      </p>
    </div>

    <!-- No results after filtering -->
    <div
      v-else-if="filteredApplications.length === 0"
      class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-12 text-center"
    >
      <Search class="size-8 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
      <h3 class="text-base font-semibold text-surface-700 dark:text-surface-200 mb-1">Нет подходящих откликов</h3>
      <p class="text-sm text-surface-500 dark:text-surface-400 mb-3">
        Измените поисковый запрос или фильтры.
      </p>
      <button
        class="text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors"
        @click="clearAllFilters"
      >
        Сбросить все фильтры
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
              Выйти из полноэкранного режима
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
                  Кандидат
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
                  Вакансия
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
                  {{ t('applications.state.label') }}
                  <ArrowUp v-if="sortKey === 'status' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'status' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <th v-if="visibleColumns.score" class="text-center px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden sm:table-cell">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('score')">
                  Балл
                  <ArrowUp v-if="sortKey === 'score' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'score' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <th v-if="visibleColumns.source" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 whitespace-nowrap hidden md:table-cell">
                Источник
              </th>
              <th v-if="visibleColumns.applied" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('created')">
                  Откликнулся
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
                <!-- Sprint 1B: FTS snippet под именем, только при активном поиске -->
                <div
                  v-if="debouncedSearch && (app as { snippet?: string }).snippet"
                  class="mt-1 text-xs text-surface-500 dark:text-surface-400 leading-snug line-clamp-2"
                  v-html="renderSnippet((app as { snippet?: string }).snippet)"
                />
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
                  @interview-selected="({ applicationId }) => openInterviewSidebar(applicationId)"
                />
              </td>
              <td v-if="visibleColumns.status" class="px-4 py-3">
                <!-- Фаза 1: состояние производно от этапа воронки (bucket/type), легаси-статус не используется -->
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap"
                  :class="stateClasses[appState(app)]"
                >{{ stateLabels[appState(app)] }}</span>
              </td>
              <td v-if="visibleColumns.score" class="px-4 py-3 text-center hidden sm:table-cell">
                <ScoreBadge :score="app.score" size="xs" />
              </td>
              <td v-if="visibleColumns.source" class="px-4 py-3 hidden md:table-cell">
                <SourceBadge :source="app.source" size="xs" />
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
            v-if="bulkStageMenuOpen && bulkStageGroups.length > 0"
            class="absolute bottom-full mb-1 left-0 min-w-[220px] max-h-80 overflow-y-auto rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-xl py-1 z-10"
          >
            <!-- Аудит синхронизации (Н-5): этапы сгруппированы по воронкам -->
            <template v-for="group in bulkStageGroups" :key="group.pipelineId">
              <div class="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500">
                {{ group.pipelineName }}
              </div>
              <button
                v-for="stage in group.stages"
                :key="stage.id"
                type="button"
                class="flex w-full items-center gap-2 py-1.5 pr-3 text-sm transition-colors"
                :class="[
                  stage.parentStageId ? 'pl-7' : 'pl-3',
                  isBulkRejectParent(stage, group.stages)
                    ? 'text-surface-400 dark:text-surface-500 cursor-default'
                    : 'text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 cursor-pointer',
                ]"
                :disabled="isBulkRejectParent(stage, group.stages)"
                :title="isBulkRejectParent(stage, group.stages) ? 'Выберите причину отказа ниже' : undefined"
                @click="bulkMoveToStage(stage.id, stage.name)"
              >
                <span class="inline-flex size-2 rounded-full shrink-0" :style="{ backgroundColor: stage.color }" />
                {{ stage.name }}
              </button>
            </template>
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

  <!-- Аудит синхронизации (Н-4): календарь планирования после перевода на этап интервью -->
  <InterviewScheduleSidebar
    v-if="interviewTarget"
    :application-id="interviewTarget.id"
    :candidate-name="interviewTarget.candidateName"
    :job-title="interviewTarget.jobTitle"
    @close="interviewTarget = null"
    @scheduled="handleInterviewScheduled"
  />
</template>
