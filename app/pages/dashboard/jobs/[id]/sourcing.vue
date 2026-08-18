<script setup lang="ts">
/**
 * Страница сорсинга hh.ru для вакансии.
 *
 * Левая колонка — список сохранённых поисков (с расписанием и статусом).
 * Правая колонка — лента кандидатов выбранного поиска или всех поисков.
 * Сверху — кнопка «Создать поиск» (3 режима: вручную / по URL / AI из JD).
 *
 * UI построен на дизайн-системе Huntfork (UiCard/UiButton/UiBadge/UiDrawer/
 * UiModal) и токенах brand/surface/success/warning/danger/info.
 * Тёмная тема поддерживается автоматически.
 */
import {
  Sparkles, Link as LinkIcon, Wrench, Search, RefreshCw, X, Check,
  Loader2, Trash2, Pencil, Play, Pause, AlertTriangle, Plus, ChevronDown,
} from 'lucide-vue-next'
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import UiCard from '~/components/ui/UiCard.vue'
import UiButton from '~/components/ui/UiButton.vue'
import UiBadge from '~/components/ui/UiBadge.vue'
import UiDrawer from '~/components/ui/UiDrawer.vue'
import SourcingCandidateCard from '~/components/sourcing/SourcingCandidateCard.vue'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const jobId = route.params.id as string
const toast = useToast()

// ─── Загрузка вакансии (для заголовка) ───
const { data: jobData } = useFetch(() => `/api/jobs/${jobId}`, {
  key: `sourcing-job-${jobId}`,
  headers: useRequestHeaders(['cookie']),
})

useSeoMeta({
  title: computed(() => jobData.value ? `Сорсинг — ${jobData.value.title}` : 'Сорсинг hh.ru'),
})

// ─── Список сохранённых поисков ───
interface SavedSearch {
  id: string
  name: string
  query: Record<string, unknown>
  sourceUrl: string | null
  scheduleMinutes: number | null
  autoRunEnabled: boolean
  maxPagesPerRun: number
  maxCandidates: number
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunError: string | null
  lastRunFound: number
  lastRunNew: number
  nextRunAt: string | null
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

/** Фазы поиска для UI-индикатора. */
type SearchPhase = 'running' | 'scheduled' | 'paused' | 'error' | 'limit_reached' | 'idle'

function phaseOf(s: SavedSearch): SearchPhase {
  if (s.lastRunStatus === 'running') return 'running'
  if (s.lastRunStatus === 'limit_reached') return 'limit_reached'
  if (s.lastRunStatus === 'error') return 'error'
  if (s.nextRunAt) return 'scheduled'
  if (s.lastRunAt && !s.autoRunEnabled) return 'paused'
  return 'idle'
}

// Tone-маппинг фаз на дизайн-токены вместо хардкод-цветов.
const PHASE_TONE: Record<SearchPhase, 'info' | 'success' | 'neutral' | 'danger' | 'warning'> = {
  running: 'info',
  scheduled: 'success',
  paused: 'neutral',
  error: 'danger',
  limit_reached: 'warning',
  idle: 'neutral',
}
const PHASE_LABEL: Record<SearchPhase, string> = {
  running: 'Сейчас ищет',
  scheduled: 'В очереди',
  paused: 'Пауза',
  error: 'Ошибка',
  limit_reached: 'Лимит достигнут',
  idle: 'Ожидание',
}
const PHASE_PULSE: Record<SearchPhase, boolean> = {
  running: true,
  scheduled: true,
  paused: false,
  error: false,
  limit_reached: false,
  idle: false,
}

const { data: searchesData, refresh: refreshSearches, pending: searchesPending } = useFetch(
  () => `/api/jobs/${jobId}/sourcing-searches`,
  {
    key: `sourcing-searches-${jobId}`,
    headers: useRequestHeaders(['cookie']),
  },
)

const searches = computed<SavedSearch[]>(() => searchesData.value?.searches ?? [])

// ─── Выбранный поиск (фильтр ленты) ───
const selectedSearchId = ref<string | null>(null)

// ─── Создание поиска ───
const showCreateModal = ref(false)
const creating = ref(false)
const createMode = ref<'manual' | 'url' | 'ai'>('ai')
const createName = ref('')
const createUrl = ref('')
const createScheduleMinutes = ref<number | null>(1440)
const createAutoRun = ref(true)
const createManualText = ref('')
const createMaxCandidates = ref(200)

function resetCreateForm() {
  createMode.value = 'ai'
  createName.value = ''
  createUrl.value = ''
  createScheduleMinutes.value = 1440
  createAutoRun.value = true
  createManualText.value = ''
  createMaxCandidates.value = 200
}

async function submitCreate() {
  if (!createName.value.trim()) {
    toast.error('Укажите название поиска')
    return
  }
  if (createMode.value === 'url' && !createUrl.value.trim()) {
    toast.error('Вставьте URL поиска hh.ru')
    return
  }
  creating.value = true
  try {
    const limit = Math.max(1, Math.min(500, Math.round(createMaxCandidates.value)))
    const body: Record<string, unknown> = {
      mode: createMode.value,
      name: createName.value.trim(),
      scheduleMinutes: createScheduleMinutes.value,
      autoRunEnabled: createAutoRun.value,
      maxCandidates: limit,
    }
    if (createMode.value === 'url') body.url = createUrl.value.trim()
    if (createMode.value === 'manual') {
      body.query = { text: createManualText.value.trim(), period: 30, orderBy: 'publication_time' }
    }

    await $fetch(`/api/jobs/${jobId}/sourcing-searches`, {
      method: 'POST',
      body,
    })
    toast.success('Поиск создан. Сорсинг запустится автоматически.')
    showCreateModal.value = false
    resetCreateForm()
    await refreshSearches()
  }
  catch (err: any) {
    toast.error('Не удалось создать поиск', { message: err?.data?.statusMessage ?? String(err) })
  }
  finally {
    creating.value = false
  }
}

// ─── Просмотр / редактирование поиска ───
const showDetailsModal = ref(false)
const detailsSearch = ref<SavedSearch | null>(null)
const editMode = ref(false)
const editName = ref('')
const editQueryJson = ref('')
const editScheduleMinutes = ref<number | null>(null)
const editAutoRun = ref(true)
const editMaxCandidates = ref(200)
const editSaving = ref(false)

function openDetails(s: SavedSearch) {
  detailsSearch.value = s
  editMode.value = false
  editName.value = s.name
  editQueryJson.value = JSON.stringify(s.query, null, 2)
  editScheduleMinutes.value = s.scheduleMinutes
  editAutoRun.value = s.autoRunEnabled
  editMaxCandidates.value = s.maxCandidates
  showDetailsModal.value = true
}

async function saveEdit() {
  if (!detailsSearch.value) return
  let parsedQuery: Record<string, unknown>
  try {
    parsedQuery = JSON.parse(editQueryJson.value)
  } catch {
    toast.error('Не валидный JSON в запросе')
    return
  }
  const limit = Math.max(1, Math.min(500, Math.round(editMaxCandidates.value)))
  editSaving.value = true
  try {
    await $fetch(`/api/sourcing-searches/${detailsSearch.value.id}`, {
      method: 'PATCH',
      body: {
        name: editName.value.trim(),
        query: parsedQuery,
        scheduleMinutes: editScheduleMinutes.value,
        autoRunEnabled: editAutoRun.value,
        maxCandidates: limit,
      },
    })
    toast.success('Поиск обновлён')
    showDetailsModal.value = false
    await refreshSearches()
  } catch (err: any) {
    toast.error('Не удалось сохранить', { message: err?.data?.statusMessage })
  } finally {
    editSaving.value = false
  }
}

// ─── Действия над поисками ───
async function runNow(searchId: string) {
  try {
    await $fetch(`/api/sourcing-searches/${searchId}/run-now`, { method: 'POST' })
    toast.success('Поиск запущен. Результаты появятся через минуту.')
    await refreshSearches()
  }
  catch (err: any) {
    toast.error('Не удалось запустить поиск', { message: err?.data?.statusMessage })
  }
}

async function archiveSearch(searchId: string) {
  if (!confirm('Архивировать этот сорсинг-поиск?')) return
  try {
    await $fetch(`/api/sourcing-searches/${searchId}`, { method: 'DELETE' })
    if (selectedSearchId.value === searchId) selectedSearchId.value = null
    toast.success('Поиск архивирован')
    await refreshSearches()
  }
  catch (err: any) {
    toast.error('Не удалось архивировать', { message: err?.data?.statusMessage })
  }
}

async function toggleAutoRun(search: SavedSearch) {
  try {
    await $fetch(`/api/sourcing-searches/${search.id}`, {
      method: 'PATCH',
      body: { autoRunEnabled: !search.autoRunEnabled },
    })
    await refreshSearches()
  }
  catch (err: any) {
    toast.error('Не удалось изменить', { message: err?.data?.statusMessage })
  }
}

// ─── Лента кандидатов ───
interface ExistingCandidateInfo {
  id: string
  firstName: string
  lastName: string
  lastApplicationSource: string | null
  applicationCount: number
  hasApplicationOnThisJob: boolean
  lastApplicationCreatedAt: string | null
}

interface SourcingCandidate {
  id: string
  savedSearchId: string
  hhResumeId: string
  snapshot: Record<string, unknown>
  score: number | null
  scoreRationale: string | null
  scoreStrengths?: string[] | null
  scoreGaps?: string[] | null
  state: 'new' | 'reviewed' | 'approved' | 'imported' | 'rejected' | 'contacted'
  applicationId: string | null
  reviewNote: string | null
  firstSeenAt: string
  lastSeenAt: string
  existingCandidate: ExistingCandidateInfo | null
}

const stateFilter = ref<'all' | 'active' | 'new' | 'reviewed' | 'approved' | 'rejected' | 'imported'>('active')

const candidatesUrl = computed(() => {
  const params = new URLSearchParams()
  if (selectedSearchId.value) params.set('savedSearchId', selectedSearchId.value)
  if (stateFilter.value !== 'all') params.set('state', stateFilter.value)
  params.set('limit', String(PAGE_SIZE))
  params.set('offset', String(offset.value))
  return `/api/jobs/${jobId}/sourcing-candidates?${params.toString()}`
})

// ─── Infinite scroll ──────────────────────────────────────
const PAGE_SIZE = 50
const candidates = ref<SourcingCandidate[]>([])
const offset = ref(0)
const hasMore = ref(true)
const loadingMore = ref(false)
const initialLoaded = ref(false)
const initialLoading = ref(false)

async function loadCandidates(reset = false) {
  if (reset) {
    offset.value = 0
    candidates.value = []
    hasMore.value = true
    initialLoaded.value = false
    initialLoading.value = true
    loadingMore.value = false
  }
  if (!hasMore.value && !reset) return
  if (!reset) loadingMore.value = true
  try {
    const res = await $fetch<{ candidates: SourcingCandidate[], limit: number, offset: number }>(candidatesUrl.value)
    if (reset) candidates.value = res.candidates
    else candidates.value.push(...res.candidates)
    hasMore.value = res.candidates.length >= PAGE_SIZE
    offset.value += res.candidates.length
    initialLoaded.value = true
  } catch (err: any) {
    toast.error('Не удалось загрузить кандидатов', { message: err?.data?.statusMessage })
    hasMore.value = false
  } finally {
    loadingMore.value = false
    initialLoading.value = false
  }
}

const candidatesPending = computed(() => initialLoading.value)

// Сброс и перезагрузка при смене фильтров/поиска.
watch([selectedSearchId, stateFilter], () => {
  selectedIds.value.clear()
  loadCandidates(true)
})

async function refreshCandidates() {
  await loadCandidates(true)
}

// IntersectionObserver для подгрузки.
let observer: IntersectionObserver | null = null
const sentinelEl = ref<HTMLElement | null>(null)

function setupObserver() {
  if (!import.meta.client) return
  if (observer) observer.disconnect()
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && hasMore.value && !loadingMore.value) {
      loadCandidates(false)
    }
  }, { rootMargin: '200px' })
  if (sentinelEl.value) observer.observe(sentinelEl.value)
}

watch(sentinelEl, (el) => {
  if (el) setupObserver()
})

onMounted(() => {
  loadCandidates(true)
})

onBeforeUnmount(() => {
  observer?.disconnect()
})

// ─── Bulk-очередь ─────────────────────────────────────────
const selectedIds = ref<Set<string>>(new Set())

function toggleSelected(id: string, value: boolean) {
  if (value) selectedIds.value.add(id)
  else selectedIds.value.delete(id)
  // Триггер реактивности Set'а.
  selectedIds.value = new Set(selectedIds.value)
}

const selectedCount = computed(() => selectedIds.value.size)

const allVisibleSelected = computed(
  () => candidates.value.length > 0 && candidates.value.every(c => selectedIds.value.has(c.id) || c.state === 'imported'),
)

function toggleSelectAll() {
  if (allVisibleSelected.value) {
    candidates.value.forEach(c => selectedIds.value.delete(c.id))
  } else {
    candidates.value.forEach(c => {
      if (c.state !== 'imported') selectedIds.value.add(c.id)
    })
  }
  selectedIds.value = new Set(selectedIds.value)
}

const bulkRunning = ref(false)

async function bulkAction(action: 'approve' | 'reject') {
  if (selectedCount.value === 0) return
  bulkRunning.value = true
  const ids = Array.from(selectedIds.value)
  let ok = 0
  let fail = 0
  try {
    await Promise.all(ids.map(async (id) => {
      try {
        await $fetch(`/api/sourcing-candidates/${id}`, { method: 'PATCH', body: { action } })
        ok++
      } catch {
        fail++
      }
    }))
    if (ok) toast.success(action === 'approve' ? `Одобрено: ${ok}` : `Отклонено: ${ok}`)
    if (fail) toast.warning(`Не удалось обработать: ${fail}`)
    selectedIds.value.clear()
    await refreshCandidates()
  } finally {
    bulkRunning.value = false
  }
}

function clearSelection() {
  selectedIds.value.clear()
}

// ─── Действия с кандидатами (одиночные) ───
async function rejectCandidate(c: SourcingCandidate) {
  try {
    await $fetch(`/api/sourcing-candidates/${c.id}`, {
      method: 'PATCH',
      body: { action: 'reject' },
    })
    selectedIds.value.delete(c.id)
    await refreshCandidates()
  }
  catch (err: any) {
    toast.error('Не удалось отклонить', { message: err?.data?.statusMessage })
  }
}

async function approveCandidate(c: SourcingCandidate) {
  try {
    await $fetch(`/api/sourcing-candidates/${c.id}`, {
      method: 'PATCH',
      body: { action: 'approve' },
    })
    await refreshCandidates()
  }
  catch (err: any) {
    toast.error('Не удалось одобрить', { message: err?.data?.statusMessage })
  }
}

const importingId = ref<string | null>(null)
async function importToPipeline(c: SourcingCandidate) {
  if (importingId.value) return
  if (c.existingCandidate?.hasApplicationOnThisJob) {
    navigateTo(`/dashboard/candidates/${c.existingCandidate.id}`)
    return
  }
  if (c.existingCandidate) {
    const ec = c.existingCandidate
    const fio = `${ec.firstName} ${ec.lastName}`.trim() || 'этот кандидат'
    const word = ec.applicationCount === 1 ? 'отклик' : (ec.applicationCount >= 2 && ec.applicationCount <= 4 ? 'отклика' : 'откликов')
    const msg = `Этот кандидат уже есть в вашей базе: ${fio} (${ec.applicationCount} ${word}). Добавить его на текущую вакансию? Будет потрачен лимит контактов hh.ru.`
    if (!confirm(msg)) return
  } else {
    if (!confirm('Импортировать в воронку? Будет потрачен лимит контактов hh.ru на получение резюме.')) return
  }
  importingId.value = c.id
  try {
    const res = await $fetch<{ candidateId?: string, applicationId?: string }>(`/api/sourcing-candidates/${c.id}/import`, { method: 'POST' })
    toast.success('Кандидат добавлен в воронку')
    await refreshCandidates()
    if (res.candidateId) {
      navigateTo(`/dashboard/candidates/${res.candidateId}`)
    } else if (res.applicationId) {
      navigateTo(`/dashboard/applications/${res.applicationId}`)
    }
  }
  catch (err: any) {
    toast.error('Не удалось импортировать', { message: err?.data?.statusMessage })
  }
  finally {
    importingId.value = null
  }
}

function openCard(c: SourcingCandidate) {
  if (c.existingCandidate) {
    navigateTo(`/dashboard/candidates/${c.existingCandidate.id}`)
  }
}

// ─── Утилиты ───
function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  return `${d} дн назад`
}

function formatSchedule(min: number | null, enabled: boolean): string {
  if (!enabled || !min) return 'Только вручную'
  if (min === 60) return 'Каждый час'
  if (min === 240) return 'Каждые 4 часа'
  if (min === 1440) return 'Раз в день'
  if (min === 10080) return 'Раз в неделю'
  if (min % 60 === 0) return `Каждые ${min / 60} ч`
  return `Каждые ${min} мин`
}

function queryPreview(q: Record<string, unknown>): string {
  const text = typeof q.text === 'string' ? q.text : ''
  if (text) return text.length > 80 ? text.slice(0, 77) + '…' : text
  const skills = Array.isArray(q.skill) ? q.skill.join(', ') : ''
  if (skills) return skills.length > 80 ? skills.slice(0, 77) + '…' : skills
  return '—'
}

const stateLabel: Record<string, string> = {
  new: 'Новый',
  reviewed: 'Просмотрен',
  approved: 'Одобрен',
  rejected: 'Отклонён',
  imported: 'В воронке',
  contacted: 'Контакт открыт',
}

const stateFilters = [
  { key: 'active', label: 'Активные', title: 'Новые + просмотренные + одобренные (рабочий список)' },
  { key: 'new', label: 'Новый' },
  { key: 'reviewed', label: 'Просмотрен' },
  { key: 'approved', label: 'Одобрен' },
  { key: 'rejected', label: 'Отклонён' },
  { key: 'imported', label: 'В воронке' },
  { key: 'all', label: 'Все' },
] as const
</script>

<template>
  <div class="p-4 sm:p-6 max-w-7xl mx-auto">
    <!-- Заголовок -->
    <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div>
        <div class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-1">
          <NuxtLink :to="$localePath('/dashboard')" class="hover:underline">Дашборд</NuxtLink>
          <span>/</span>
          <NuxtLink :to="$localePath(`/dashboard/jobs/${jobId}`)" class="hover:underline">
            {{ jobData?.title ?? 'Вакансия' }}
          </NuxtLink>
          <span>/</span>
          <span>Сорсинг hh.ru</span>
        </div>
        <h1 class="text-2xl font-semibold flex items-center gap-2 text-surface-900 dark:text-surface-100">
          <Search class="size-6 text-brand-600" />
          Сорсинг hh.ru
        </h1>
        <p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
          Автоматический холодный поиск кандидатов из базы резюме hh.ru. Без хранения контактов — только анонимные сниппеты.
        </p>
      </div>
      <UiButton :icon-left="Sparkles" @click="showCreateModal = true">
        Создать поиск
      </UiButton>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
      <!-- Левая колонка: список поисков -->
      <aside class="space-y-2">
        <div class="flex items-center justify-between px-1">
          <div class="text-xs uppercase font-semibold text-surface-500 dark:text-surface-400 tracking-wide">
            Сохранённые поиски
          </div>
          <button
            v-if="searches.length > 0"
            class="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 inline-flex items-center gap-1"
            @click="refreshSearches()"
          >
            <RefreshCw class="size-3" :class="searchesPending ? 'animate-spin' : ''" />
          </button>
        </div>

        <div v-if="searchesPending" class="text-sm text-surface-500 px-1">Загрузка...</div>

        <div v-else-if="searches.length === 0">
          <UiCard variant="dashed" padding="lg" class="text-center">
            <Search class="size-8 text-surface-300 mx-auto mb-2" />
            <p class="text-sm text-surface-600 dark:text-surface-400 mb-3">
              Пока нет поисков. Создайте первый.
            </p>
            <UiButton size="sm" :icon-left="Plus" @click="showCreateModal = true">
              Создать поиск
            </UiButton>
          </UiCard>
        </div>

        <template v-else>
          <!-- «Все поиски» -->
          <button
            class="w-full text-left rounded-xl border px-3 py-2.5 text-sm transition-colors"
            :class="selectedSearchId === null
              ? 'border-brand-500 bg-brand-50 dark:bg-brand-950'
              : 'border-surface-200 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-900'"
            @click="selectedSearchId = null"
          >
            Все поиски
          </button>

          <!-- Карточки поисков -->
          <UiCard
            v-for="s in searches"
            :key="s.id"
            variant="outlined"
            padding="sm"
            interactive
            :class="selectedSearchId === s.id ? 'ring-2 ring-brand-500 border-brand-300 dark:border-brand-700' : ''"
          >
            <button class="text-left w-full" @click="selectedSearchId = s.id">
              <div class="flex items-start gap-2">
                <div class="font-medium truncate flex-1 text-surface-800 dark:text-surface-100">
                  {{ s.name }}
                </div>
                <UiBadge :tone="PHASE_TONE[phaseOf(s)]" size="sm" :title="PHASE_LABEL[phaseOf(s)]">
                  <span
                    class="size-1.5 rounded-full inline-block mr-1"
                    :class="[
                      PHASE_TONE[phaseOf(s)] === 'info' ? 'bg-info-500'
                      : PHASE_TONE[phaseOf(s)] === 'success' ? 'bg-success-500'
                      : PHASE_TONE[phaseOf(s)] === 'danger' ? 'bg-danger-500'
                      : PHASE_TONE[phaseOf(s)] === 'warning' ? 'bg-warning-500'
                      : 'bg-surface-400',
                      PHASE_PULSE[phaseOf(s)] ? 'animate-pulse' : '',
                    ]"
                  />
                  {{ PHASE_LABEL[phaseOf(s)] }}
                </UiBadge>
              </div>
              <div class="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                {{ formatSchedule(s.scheduleMinutes, s.autoRunEnabled) }}
              </div>
              <div class="text-xs text-surface-400 dark:text-surface-500 mt-0.5 truncate">
                {{ queryPreview(s.query) }}
              </div>
            </button>

            <!-- Мини-статистика + действия -->
            <div class="flex items-center gap-2 mt-2 pt-2 border-t border-surface-200 dark:border-surface-800">
              <span class="text-xs text-surface-500 dark:text-surface-400">
                <span class="font-medium text-surface-700 dark:text-surface-200">{{ s.lastRunNew }}</span> новых
              </span>
              <span v-if="s.lastRunAt" class="text-xs text-surface-400 dark:text-surface-500">
                · {{ formatRelative(s.lastRunAt) }}
              </span>
              <div class="ml-auto flex items-center gap-0.5">
                <button
                  class="p-1 rounded text-surface-400 hover:text-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800"
                  title="Запустить сейчас"
                  @click.stop="runNow(s.id)"
                >
                  <Play class="size-3.5" />
                </button>
                <button
                  class="p-1 rounded text-surface-400 hover:text-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800"
                  :title="s.autoRunEnabled ? 'Поставить на паузу' : 'Включить автозапуск'"
                  @click.stop="toggleAutoRun(s)"
                >
                  <component :is="s.autoRunEnabled ? Pause : Play" class="size-3.5" />
                </button>
                <button
                  class="p-1 rounded text-surface-400 hover:text-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800"
                  title="Детали / редактировать"
                  @click.stop="openDetails(s)"
                >
                  <Pencil class="size-3.5" />
                </button>
                <button
                  class="p-1 rounded text-surface-400 hover:text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-950"
                  title="Архивировать"
                  @click.stop="archiveSearch(s.id)"
                >
                  <Trash2 class="size-3.5" />
                </button>
              </div>
            </div>

            <div v-if="s.lastRunError" class="mt-2 text-xs text-danger-700 dark:text-danger-400 flex items-start gap-1">
              <AlertTriangle class="size-3.5 mt-0.5 shrink-0" />
              <span class="font-mono truncate">{{ s.lastRunError }}</span>
            </div>
          </UiCard>
        </template>
      </aside>

      <!-- Правая колонка: лента кандидатов -->
      <section>
        <!-- Тулбар: фильтр статуса + bulk-счётчик + обновить -->
        <div class="flex items-center gap-2 mb-4 flex-wrap">
          <button
            v-if="candidates.length > 0"
            class="flex items-center justify-center size-7 rounded-md border border-surface-200 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-900"
            :title="allVisibleSelected ? 'Снять выделение' : 'Выделить все'"
            @click="toggleSelectAll"
          >
            <Check v-if="allVisibleSelected" class="size-4 text-brand-600" />
          </button>
          <div class="text-sm text-surface-600 dark:text-surface-400">Статус:</div>
          <div class="flex gap-1 flex-wrap">
            <button
              v-for="sf in stateFilters"
              :key="sf.key"
              class="px-3 py-1 rounded-full text-xs font-medium transition-colors"
              :class="stateFilter === sf.key
                ? 'bg-surface-800 dark:bg-surface-200 text-white dark:text-surface-900'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700'"
              :title="'title' in sf ? sf.title : undefined"
              @click="stateFilter = sf.key"
            >
              {{ sf.label }}
            </button>
          </div>
          <UiButton
            class="ml-auto"
            size="sm"
            variant="ghost"
            :icon-left="RefreshCw"
            :disabled="loadingMore"
            @click="refreshCandidates()"
          >
            Обновить
          </UiButton>
        </div>

        <!-- Состояния -->
        <div v-if="candidatesPending" class="space-y-3">
          <UiCard v-for="i in 4" :key="i" padding="md">
            <div class="animate-pulse space-y-2">
              <div class="h-4 bg-surface-200 dark:bg-surface-800 rounded w-1/3" />
              <div class="h-3 bg-surface-100 dark:bg-surface-800 rounded w-1/2" />
              <div class="h-3 bg-surface-100 dark:bg-surface-800 rounded w-2/3" />
            </div>
          </UiCard>
        </div>

        <UiCard v-else-if="candidates.length === 0" variant="dashed" padding="lg" class="text-center py-12">
          <Search class="size-10 text-surface-300 mx-auto mb-3" />
          <p class="text-sm text-surface-600 dark:text-surface-400">
            Кандидатов нет.
            <span v-if="searches.length === 0">Создайте поиск, чтобы получить первые результаты.</span>
            <span v-else>Подождите, пока запустится фоновый сорсинг (~1 мин после создания).</span>
          </p>
        </UiCard>

        <div v-else class="space-y-3">
          <SourcingCandidateCard
            v-for="c in candidates"
            :key="c.id"
            :candidate="c"
            :selected="selectedIds.has(c.id)"
            :importing="importingId"
            @update:selected="(v) => toggleSelected(c.id, v)"
            @import="importToPipeline"
            @approve="approveCandidate"
            @reject="rejectCandidate"
            @open-card="openCard"
          />

          <!-- Sentinel для infinite scroll -->
          <div ref="sentinelEl" class="h-1" />

          <!-- Индикатор подгрузки -->
          <div v-if="loadingMore" class="flex items-center justify-center py-4 text-sm text-surface-500">
            <Loader2 class="size-4 animate-spin mr-2" />
            Загрузка...
          </div>
          <div v-else-if="!hasMore && candidates.length > 0" class="text-center py-4 text-xs text-surface-400">
            Все кандидаты загружены ({{ candidates.length }})
          </div>
        </div>
      </section>
    </div>

    <!-- Плавающий bulk-action-bar -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-y-4 opacity-0"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="translate-y-4 opacity-0"
      >
        <div
          v-if="selectedCount > 0"
          class="fixed bottom-6 left-1/2 -translate-x-1/2 z-40"
        >
          <UiCard variant="elevated" padding="sm" class="flex items-center gap-2 shadow-lg">
            <span class="text-sm font-medium text-surface-700 dark:text-surface-200 px-2">
              Выбрано: {{ selectedCount }}
            </span>
            <div class="h-5 w-px bg-surface-200 dark:bg-surface-700" />
            <UiButton size="sm" variant="ghost" :icon-left="Check" :disabled="bulkRunning" @click="bulkAction('approve')">
              Одобрить
            </UiButton>
            <UiButton
              size="sm"
              variant="ghost"
              class="text-danger-700 hover:bg-danger-50 dark:text-danger-400"
              :icon-left="X"
              :disabled="bulkRunning"
              @click="bulkAction('reject')"
            >
              Отклонить
            </UiButton>
            <UiButton size="sm" variant="ghost" :icon-left="Loader2" :class="bulkRunning ? 'animate-pulse' : ''" @click="clearSelection">
              Сбросить
            </UiButton>
          </UiCard>
        </div>
      </Transition>
    </Teleport>

    <!-- Модалка создания поиска -->
    <Teleport to="body">
      <div
        v-if="showCreateModal"
        class="fixed inset-0 bg-black/40 dark:bg-black/60 z-50 flex items-center justify-center p-4"
        @click.self="showCreateModal = false"
      >
        <UiCard variant="default" padding="lg" class="max-w-lg w-full shadow-2xl">
          <div class="flex items-start justify-between mb-4">
            <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100">
              Новый сорсинг-поиск hh.ru
            </h2>
            <button
              class="text-surface-400 hover:text-surface-700 dark:hover:text-surface-200"
              @click="showCreateModal = false"
            >
              <X class="size-5" />
            </button>
          </div>

          <!-- Режим -->
          <div class="mb-4">
            <div class="text-xs font-medium text-surface-600 dark:text-surface-400 mb-2">Режим</div>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="m in [
                  { key: 'ai', label: 'AI из JD', desc: 'Сгенерировать из описания вакансии', icon: Sparkles },
                  { key: 'url', label: 'По URL', desc: 'Вставить ссылку поиска hh.ru', icon: LinkIcon },
                  { key: 'manual', label: 'Вручную', desc: 'Ввести ключевые слова', icon: Wrench },
                ]"
                :key="m.key"
                class="rounded-lg border p-3 text-sm text-left transition-colors"
                :class="createMode === m.key
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-950'
                  : 'border-surface-200 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-900'"
                @click="createMode = m.key as 'manual' | 'url' | 'ai'"
              >
                <component :is="m.icon" class="size-4 mb-1 text-brand-600" />
                <div class="font-medium text-surface-800 dark:text-surface-100">{{ m.label }}</div>
                <div class="text-xs text-surface-500 dark:text-surface-400">{{ m.desc }}</div>
              </button>
            </div>
          </div>

          <!-- Название -->
          <div class="mb-4">
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
              Название поиска
            </label>
            <input
              v-model="createName"
              type="text"
              placeholder="Senior Python — Москва"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 dark:bg-surface-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 text-surface-900 dark:text-surface-100"
            />
          </div>

          <!-- URL поле -->
          <div v-if="createMode === 'url'" class="mb-4">
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
              URL поиска hh.ru
            </label>
            <input
              v-model="createUrl"
              type="url"
              placeholder="https://hh.ru/search/resume?text=..."
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 dark:bg-surface-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 text-surface-900 dark:text-surface-100"
            />
          </div>

          <!-- Manual text -->
          <div v-if="createMode === 'manual'" class="mb-4">
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
              Ключевые слова
            </label>
            <textarea
              v-model="createManualText"
              rows="3"
              placeholder="Python AND (Django OR FastAPI) NOT junior"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 dark:bg-surface-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 text-surface-900 dark:text-surface-100"
            />
            <div class="text-xs text-surface-400 mt-1">
              Поддерживаются AND/OR/NOT, кавычки для фраз, * для маски.
            </div>
          </div>

          <!-- Расписание -->
          <div class="mb-4">
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
              Расписание
            </label>
            <select
              v-model="createScheduleMinutes"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 dark:bg-surface-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 text-surface-900 dark:text-surface-100"
            >
              <option :value="null">Только вручную</option>
              <option :value="60">Каждый час</option>
              <option :value="240">Каждые 4 часа</option>
              <option :value="1440">Раз в день</option>
              <option :value="10080">Раз в неделю</option>
            </select>
          </div>

          <!-- Автозапуск -->
          <label class="inline-flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300 mb-4">
            <input v-model="createAutoRun" type="checkbox" class="rounded text-brand-600 focus:ring-brand-500" />
            Автоматический запуск
          </label>

          <!-- Лимит -->
          <div class="mb-6">
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
              Лимит кандидатов (1–500)
            </label>
            <div class="flex items-center gap-3">
              <input
                v-model.number="createMaxCandidates"
                type="number"
                min="1"
                max="500"
                class="w-28 rounded-lg border border-surface-300 dark:border-surface-700 dark:bg-surface-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 text-surface-900 dark:text-surface-100"
              />
              <input
                v-model.number="createMaxCandidates"
                type="range"
                min="1"
                max="500"
                step="1"
                class="flex-1 accent-brand-600"
              />
            </div>
          </div>

          <div class="flex gap-2 justify-end">
            <UiButton variant="secondary" @click="showCreateModal = false">Отмена</UiButton>
            <UiButton :icon-left="creating ? Loader2 : Plus" :disabled="creating" @click="submitCreate">
              <Loader2 v-if="creating" class="size-4 animate-spin mr-1" />
              Создать
            </UiButton>
          </div>
        </UiCard>
      </div>
    </Teleport>

    <!-- Дровер деталей / редактирования поиска -->
    <UiDrawer v-model:open="showDetailsModal" width="md">
      <div v-if="detailsSearch" class="space-y-4">
        <div class="flex items-start justify-between">
          <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100">
            {{ editMode ? 'Редактирование поиска' : detailsSearch.name }}
          </h2>
          <button
            class="text-surface-400 hover:text-surface-700 dark:hover:text-surface-200"
            @click="showDetailsModal = false"
          >
            <X class="size-5" />
          </button>
        </div>

        <!-- Название -->
        <div>
          <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Название</label>
          <input
            v-if="editMode"
            v-model="editName"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 dark:bg-surface-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 text-surface-900 dark:text-surface-100"
          />
          <div v-else class="text-sm text-surface-800 dark:text-surface-100">{{ detailsSearch.name }}</div>
        </div>

        <!-- Query JSON -->
        <div>
          <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Параметры запроса (JSON)
          </label>
          <textarea
            v-if="editMode"
            v-model="editQueryJson"
            rows="8"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 dark:bg-surface-900 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 text-surface-900 dark:text-surface-100"
          />
          <pre v-else class="text-xs font-mono bg-surface-50 dark:bg-surface-900 rounded-lg p-3 overflow-auto text-surface-700 dark:text-surface-300">{{ JSON.stringify(detailsSearch.query, null, 2) }}</pre>
          <div v-if="editMode" class="text-xs text-surface-500 mt-1">
            Основные поля: <code>text</code> (AND/OR/NOT, кавычки, *), <code>textLogic</code>, <code>textField</code>, <code>area</code>, <code>experience</code>, <code>workFormat</code>, <code>employmentForm</code>, <code>professionalRole</code>, <code>salaryFrom</code>, <code>currency</code>, <code>period</code>, <code>orderBy</code>.
          </div>
        </div>

        <!-- Расписание + Авто -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Расписание</label>
            <select
              v-if="editMode"
              v-model="editScheduleMinutes"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 dark:bg-surface-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 text-surface-900 dark:text-surface-100"
            >
              <option :value="null">Только вручную</option>
              <option :value="60">Каждый час</option>
              <option :value="240">Каждые 4 часа</option>
              <option :value="1440">Раз в день</option>
              <option :value="10080">Раз в неделю</option>
            </select>
            <div v-else class="text-sm text-surface-800 dark:text-surface-100">
              {{ formatSchedule(detailsSearch.scheduleMinutes, detailsSearch.autoRunEnabled) }}
            </div>
          </div>
          <div class="flex items-end">
            <label v-if="editMode" class="inline-flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
              <input v-model="editAutoRun" type="checkbox" class="rounded text-brand-600 focus:ring-brand-500" />
              Автозапуск
            </label>
            <div v-else class="text-sm text-surface-800 dark:text-surface-100">
              Автозапуск: <b>{{ detailsSearch.autoRunEnabled ? 'вкл' : 'выкл' }}</b>
            </div>
          </div>
        </div>

        <!-- Лимит -->
        <div>
          <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Лимит кандидатов (1–500)
          </label>
          <div v-if="editMode" class="flex items-center gap-3">
            <input
              v-model.number="editMaxCandidates"
              type="number"
              min="1"
              max="500"
              class="w-28 rounded-lg border border-surface-300 dark:border-surface-700 dark:bg-surface-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 text-surface-900 dark:text-surface-100"
            />
            <input
              v-model.number="editMaxCandidates"
              type="range"
              min="1"
              max="500"
              step="1"
              class="flex-1 accent-brand-600"
            />
          </div>
          <div v-else class="text-sm text-surface-800 dark:text-surface-100">{{ detailsSearch.maxCandidates }}</div>
        </div>

        <!-- Статистика -->
        <div v-if="!editMode" class="grid grid-cols-3 gap-3 text-xs">
          <div class="bg-surface-50 dark:bg-surface-900 rounded-lg p-2">
            <div class="text-surface-500">Последний запуск</div>
            <div class="font-medium text-surface-800 dark:text-surface-100">
              {{ detailsSearch.lastRunAt ? formatRelative(detailsSearch.lastRunAt) : 'нет' }}
            </div>
          </div>
          <div class="bg-surface-50 dark:bg-surface-900 rounded-lg p-2">
            <div class="text-surface-500">Найдено</div>
            <div class="font-medium text-surface-800 dark:text-surface-100">{{ detailsSearch.lastRunFound }}</div>
          </div>
          <div class="bg-surface-50 dark:bg-surface-900 rounded-lg p-2">
            <div class="text-surface-500">Новых</div>
            <div class="font-medium text-success-700 dark:text-success-400">{{ detailsSearch.lastRunNew }}</div>
          </div>
        </div>

        <div
          v-if="detailsSearch.lastRunError"
          class="text-xs bg-danger-50 dark:bg-danger-950 border border-danger-200 dark:border-danger-900 text-danger-800 dark:text-danger-300 rounded-lg p-3"
        >
          <div class="font-medium flex items-center gap-1">
            <AlertTriangle class="size-3.5" />
            Ошибка последнего запуска
          </div>
          <div class="mt-1 font-mono">{{ detailsSearch.lastRunError }}</div>
        </div>

        <div class="flex gap-2 justify-end pt-4 border-t border-surface-200 dark:border-surface-800">
          <UiButton variant="secondary" @click="showDetailsModal = false">Закрыть</UiButton>
          <UiButton v-if="!editMode" variant="secondary" :icon-left="Pencil" @click="editMode = true">
            Редактировать
          </UiButton>
          <UiButton
            v-else
            :icon-left="editSaving ? Loader2 : Check"
            :disabled="editSaving"
            @click="saveEdit"
          >
            <Loader2 v-if="editSaving" class="size-4 animate-spin mr-1" />
            Сохранить
          </UiButton>
        </div>
      </div>
    </UiDrawer>
  </div>
</template>
