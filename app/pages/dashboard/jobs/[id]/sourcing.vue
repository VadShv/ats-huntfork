<script setup lang="ts">
/**
 * Страница сорсинга hh.ru для вакансии.
 *
 * Левая колонка — список сохранённых поисков (с расписанием и статусом).
 * Правая колонка — лента кандидатов выбранного поиска или всех поисков.
 * Сверху — кнопка «Создать поиск» (3 режима: вручную / по URL / AI из JD).
 */
import { Sparkles, Link as LinkIcon, Wrench, Search, RefreshCw, X, Check, ExternalLink, ChevronDown, Loader2, Trash2 } from 'lucide-vue-next'

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

function resetCreateForm() {
  createMode.value = 'ai'
  createName.value = ''
  createUrl.value = ''
  createScheduleMinutes.value = 1440
  createAutoRun.value = true
  createManualText.value = ''
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
    const body: Record<string, unknown> = {
      mode: createMode.value,
      name: createName.value.trim(),
      scheduleMinutes: createScheduleMinutes.value,
      autoRunEnabled: createAutoRun.value,
    }
    if (createMode.value === 'url') body.url = createUrl.value.trim()
    if (createMode.value === 'manual') {
      body.query = { text: createManualText.value.trim(), period: 30, orderBy: 'publication_time' }
    }

    await $fetch(`/api/jobs/${jobId}/sourcing-searches`, {
      method: 'POST',
      body,
    })
    toast.success?.('Поиск создан. Сорсинг запустится автоматически.')
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

// ─── Действия над поисками ───
async function runNow(searchId: string) {
  try {
    await $fetch(`/api/sourcing-searches/${searchId}/run-now`, { method: 'POST' })
    toast.success?.('Поиск запущен. Результаты появятся через минуту.')
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
    toast.success?.('Поиск архивирован')
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
interface SourcingCandidate {
  id: string
  savedSearchId: string
  hhResumeId: string
  snapshot: {
    title?: string | null
    areaName?: string | null
    salaryAmount?: number | null
    salaryCurrency?: string | null
    experienceYears?: number | null
    lastCompany?: string | null
    lastPosition?: string | null
    age?: number | null
    updatedAt?: string | null
  }
  score: number | null
  scoreRationale: string | null
  state: 'new' | 'reviewed' | 'approved' | 'imported' | 'rejected' | 'contacted'
  applicationId: string | null
  reviewNote: string | null
  firstSeenAt: string
  lastSeenAt: string
}

const stateFilter = ref<'all' | 'new' | 'reviewed' | 'approved' | 'rejected' | 'imported'>('new')

const candidatesUrl = computed(() => {
  const params = new URLSearchParams()
  if (selectedSearchId.value) params.set('savedSearchId', selectedSearchId.value)
  if (stateFilter.value !== 'all') params.set('state', stateFilter.value)
  params.set('limit', '100')
  return `/api/jobs/${jobId}/sourcing-candidates?${params.toString()}`
})

const { data: candidatesData, refresh: refreshCandidates, pending: candidatesPending } = useFetch(
  candidatesUrl,
  {
    key: computed(() => `sourcing-cands-${jobId}-${selectedSearchId.value ?? 'all'}-${stateFilter.value}`),
    headers: useRequestHeaders(['cookie']),
    watch: [selectedSearchId, stateFilter],
  },
)

const candidates = computed<SourcingCandidate[]>(() => candidatesData.value?.candidates ?? [])

// ─── Действия с кандидатами ───
async function rejectCandidate(c: SourcingCandidate) {
  try {
    await $fetch(`/api/sourcing-candidates/${c.id}`, {
      method: 'PATCH',
      body: { action: 'reject' },
    })
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
  if (!confirm('Импортировать в воронку? Будет потрачен лимит контактов hh.ru на получение резюме.')) return
  importingId.value = c.id
  try {
    const res = await $fetch(`/api/sourcing-candidates/${c.id}/import`, { method: 'POST' })
    toast.success?.('Кандидат добавлен в воронку')
    await refreshCandidates()
    if (res.applicationId) {
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

function formatSalary(c: SourcingCandidate): string {
  const s = c.snapshot
  if (!s.salaryAmount) return ''
  return `${s.salaryAmount.toLocaleString('ru')} ${s.salaryCurrency ?? 'RUR'}`
}

function formatSchedule(min: number | null, enabled: boolean): string {
  if (!enabled || !min) return 'Только вручную'
  if (min === 60) return 'Каждый час'
  if (min === 1440) return 'Раз в день'
  if (min === 10080) return 'Раз в неделю'
  if (min % 60 === 0) return `Каждые ${min / 60} ч`
  return `Каждые ${min} мин`
}

const stateLabel: Record<string, string> = {
  new: 'Новый',
  reviewed: 'Просмотрен',
  approved: 'Одобрен',
  rejected: 'Отклонён',
  imported: 'В воронке',
  contacted: 'Контакт открыт',
}

const stateBadgeClass: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  reviewed: 'bg-slate-100 text-slate-700',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  imported: 'bg-purple-100 text-purple-800',
  contacted: 'bg-amber-100 text-amber-900',
}
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- Заголовок -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <div class="flex items-center gap-2 text-sm text-slate-500 mb-1">
          <NuxtLink to="/dashboard" class="hover:underline">Дашборд</NuxtLink>
          <span>/</span>
          <NuxtLink :to="`/dashboard/jobs/${jobId}`" class="hover:underline">
            {{ jobData?.title ?? 'Вакансия' }}
          </NuxtLink>
          <span>/</span>
          <span>Сорсинг hh.ru</span>
        </div>
        <h1 class="text-2xl font-semibold flex items-center gap-2">
          <Search class="h-6 w-6 text-emerald-600" />
          Сорсинг hh.ru
        </h1>
        <p class="text-sm text-slate-600 mt-1">
          Автоматический холодный поиск кандидатов из базы резюме hh.ru. Без хранения контактов — только анонимные сниппеты.
        </p>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700"
        @click="showCreateModal = true"
      >
        <Sparkles class="h-4 w-4" />
        Создать поиск
      </button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <!-- Левая колонка: список поисков -->
      <aside class="space-y-3">
        <div class="text-xs uppercase font-semibold text-slate-500 tracking-wide px-1">
          Сохранённые поиски
        </div>
        <div v-if="searchesPending" class="text-sm text-slate-500 px-1">Загрузка...</div>
        <div v-else-if="searches.length === 0" class="text-sm text-slate-500 px-1">
          Пока нет поисков. Создайте первый.
        </div>
        <button
          v-if="searches.length > 0"
          class="w-full text-left rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
          :class="selectedSearchId === null ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'"
          @click="selectedSearchId = null"
        >
          Все поиски
        </button>
        <div v-for="s in searches" :key="s.id" class="rounded-lg border p-3 text-sm"
          :class="selectedSearchId === s.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'">
          <button class="text-left w-full" @click="selectedSearchId = s.id">
            <div class="font-medium truncate">{{ s.name }}</div>
            <div class="text-xs text-slate-500 mt-0.5">
              {{ formatSchedule(s.scheduleMinutes, s.autoRunEnabled) }}
            </div>
            <div class="text-xs text-slate-500 mt-1">
              <span v-if="s.lastRunAt">
                Последний запуск: {{ formatRelative(s.lastRunAt) }}
                <span v-if="s.lastRunStatus === 'error'" class="text-rose-600">⚠ ошибка</span>
                <span v-else-if="s.lastRunStatus === 'running'" class="text-blue-600">▶ выполняется</span>
              </span>
              <span v-else class="text-slate-400">ещё не запускался</span>
            </div>
            <div class="text-xs mt-1 flex gap-3">
              <span>Найдено: <b>{{ s.lastRunFound }}</b></span>
              <span>Новых: <b class="text-emerald-700">{{ s.lastRunNew }}</b></span>
            </div>
          </button>
          <div class="mt-2 flex gap-1 pt-2 border-t border-slate-100">
            <button
              class="text-xs px-2 py-1 rounded hover:bg-slate-100 inline-flex items-center gap-1"
              :disabled="s.lastRunStatus === 'running'"
              @click="runNow(s.id)"
            >
              <RefreshCw class="h-3 w-3" />
              Запустить
            </button>
            <button
              class="text-xs px-2 py-1 rounded hover:bg-slate-100"
              @click="toggleAutoRun(s)"
            >
              {{ s.autoRunEnabled ? 'Пауза' : 'Авто' }}
            </button>
            <button
              class="text-xs px-2 py-1 rounded hover:bg-rose-50 text-rose-700 ml-auto inline-flex items-center gap-1"
              @click="archiveSearch(s.id)"
            >
              <Trash2 class="h-3 w-3" />
            </button>
          </div>
        </div>
      </aside>

      <!-- Правая колонка: лента кандидатов -->
      <section>
        <!-- Фильтр по статусу -->
        <div class="flex items-center gap-2 mb-4">
          <div class="text-sm text-slate-600">Статус:</div>
          <div class="flex gap-1">
            <button v-for="s in (['new', 'reviewed', 'approved', 'rejected', 'imported', 'all'] as const)" :key="s"
              class="px-3 py-1 rounded-full text-xs font-medium"
              :class="stateFilter === s ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'"
              @click="stateFilter = s">
              {{ s === 'all' ? 'Все' : stateLabel[s] }}
            </button>
          </div>
          <button class="ml-auto text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
            @click="refreshCandidates()">
            <RefreshCw class="h-3 w-3" />
            Обновить
          </button>
        </div>

        <div v-if="candidatesPending" class="text-sm text-slate-500 py-8 text-center">
          Загрузка...
        </div>
        <div v-else-if="candidates.length === 0" class="text-sm text-slate-500 py-12 text-center bg-slate-50 rounded-lg">
          Кандидатов нет.
          <span v-if="searches.length === 0">Создайте поиск, чтобы получить первые результаты.</span>
          <span v-else>Подождите, пока запустится фоновый сорсинг (~1 мин после создания).</span>
        </div>

        <div v-else class="space-y-3">
          <div v-for="c in candidates" :key="c.id" class="rounded-lg border border-slate-200 p-4 bg-white">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium">{{ c.snapshot.title || 'Без названия' }}</span>
                  <span class="px-2 py-0.5 rounded-full text-xs font-medium" :class="stateBadgeClass[c.state]">
                    {{ stateLabel[c.state] }}
                  </span>
                  <span v-if="c.score !== null" class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                    Score: {{ c.score }}
                  </span>
                </div>
                <div class="text-sm text-slate-600 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                  <span v-if="c.snapshot.areaName">📍 {{ c.snapshot.areaName }}</span>
                  <span v-if="c.snapshot.experienceYears">⏱ Опыт: {{ c.snapshot.experienceYears }} лет</span>
                  <span v-if="c.snapshot.age">👤 {{ c.snapshot.age }} лет</span>
                  <span v-if="formatSalary(c)">💰 {{ formatSalary(c) }}</span>
                </div>
                <div v-if="c.snapshot.lastPosition" class="text-sm text-slate-500 mt-1">
                  Последнее: {{ c.snapshot.lastPosition }}
                  <span v-if="c.snapshot.lastCompany">в «{{ c.snapshot.lastCompany }}»</span>
                </div>
                <div class="text-xs text-slate-400 mt-2">
                  Найден: {{ formatRelative(c.firstSeenAt) }}
                </div>
              </div>
              <div class="flex flex-col gap-1.5">
                <button
                  v-if="c.state !== 'imported'"
                  class="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  :disabled="importingId === c.id"
                  @click="importToPipeline(c)"
                >
                  <Loader2 v-if="importingId === c.id" class="h-3.5 w-3.5 animate-spin" />
                  <ExternalLink v-else class="h-3.5 w-3.5" />
                  В воронку
                </button>
                <NuxtLink
                  v-else-if="c.applicationId"
                  :to="`/dashboard/applications/${c.applicationId}`"
                  class="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm bg-slate-100 hover:bg-slate-200"
                >
                  Открыть отклик
                </NuxtLink>
                <button
                  v-if="c.state === 'new'"
                  class="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm bg-slate-100 hover:bg-slate-200"
                  @click="approveCandidate(c)"
                >
                  <Check class="h-3.5 w-3.5" />
                  Одобрить
                </button>
                <button
                  v-if="c.state !== 'rejected' && c.state !== 'imported'"
                  class="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm text-rose-700 hover:bg-rose-50"
                  @click="rejectCandidate(c)"
                >
                  <X class="h-3.5 w-3.5" />
                  Отклонить
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Модалка создания поиска -->
    <Teleport to="body">
      <div v-if="showCreateModal" class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
        @click.self="showCreateModal = false">
        <div class="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl">
          <div class="flex items-start justify-between mb-4">
            <h2 class="text-lg font-semibold">Новый сорсинг-поиск hh.ru</h2>
            <button @click="showCreateModal = false" class="text-slate-400 hover:text-slate-800">
              <X class="h-5 w-5" />
            </button>
          </div>

          <!-- Режим -->
          <div class="mb-4">
            <div class="text-xs font-medium text-slate-600 mb-2">Режим</div>
            <div class="grid grid-cols-3 gap-2">
              <button class="rounded-lg border p-3 text-sm text-left"
                :class="createMode === 'ai' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'"
                @click="createMode = 'ai'">
                <Sparkles class="h-4 w-4 mb-1 text-emerald-600" />
                <div class="font-medium">AI из JD</div>
                <div class="text-xs text-slate-500">Сгенерировать из описания вакансии</div>
              </button>
              <button class="rounded-lg border p-3 text-sm text-left"
                :class="createMode === 'url' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'"
                @click="createMode = 'url'">
                <LinkIcon class="h-4 w-4 mb-1 text-emerald-600" />
                <div class="font-medium">По URL</div>
                <div class="text-xs text-slate-500">Вставить ссылку поиска hh.ru</div>
              </button>
              <button class="rounded-lg border p-3 text-sm text-left"
                :class="createMode === 'manual' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'"
                @click="createMode = 'manual'">
                <Wrench class="h-4 w-4 mb-1 text-emerald-600" />
                <div class="font-medium">Вручную</div>
                <div class="text-xs text-slate-500">Ввести ключевые слова</div>
              </button>
            </div>
          </div>

          <!-- Название -->
          <div class="mb-4">
            <label class="block text-xs font-medium text-slate-600 mb-1">Название поиска</label>
            <input v-model="createName" type="text" placeholder="Senior Python — Москва"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>

          <!-- URL поле (для url-режима) -->
          <div v-if="createMode === 'url'" class="mb-4">
            <label class="block text-xs font-medium text-slate-600 mb-1">URL поиска hh.ru</label>
            <input v-model="createUrl" type="url" placeholder="https://hh.ru/search/resume?text=..."
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>

          <!-- Manual текст -->
          <div v-if="createMode === 'manual'" class="mb-4">
            <label class="block text-xs font-medium text-slate-600 mb-1">Поисковая строка</label>
            <textarea v-model="createManualText" rows="3" placeholder='(python OR django) AND postgresql NOT интерн'
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"></textarea>
            <div class="text-xs text-slate-500 mt-1">
              Поддерживаются AND/OR/NOT, кавычки для фраз.
            </div>
          </div>

          <!-- AI-режим: подсказка -->
          <div v-if="createMode === 'ai'" class="mb-4 text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
            Запрос будет сгенерирован из описания вакансии. Убедитесь, что в вакансии есть подробное описание.
          </div>

          <!-- Расписание -->
          <div class="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-slate-600 mb-1">Расписание</label>
              <select v-model="createScheduleMinutes"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option :value="null">Только вручную</option>
                <option :value="60">Каждый час</option>
                <option :value="240">Каждые 4 часа</option>
                <option :value="1440">Раз в день</option>
                <option :value="10080">Раз в неделю</option>
              </select>
            </div>
            <div class="flex items-end">
              <label class="inline-flex items-center gap-2 text-sm">
                <input v-model="createAutoRun" type="checkbox" class="rounded text-emerald-600" />
                Автоматический запуск
              </label>
            </div>
          </div>

          <div class="flex gap-2 justify-end pt-4 border-t border-slate-200">
            <button class="px-4 py-2 rounded-lg text-sm hover:bg-slate-100" @click="showCreateModal = false">
              Отмена
            </button>
            <button
              class="px-4 py-2 rounded-lg text-sm bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-2 disabled:opacity-60"
              :disabled="creating"
              @click="submitCreate"
            >
              <Loader2 v-if="creating" class="h-4 w-4 animate-spin" />
              Создать
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
