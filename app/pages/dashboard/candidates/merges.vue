<script setup lang="ts">
import { History, GitMerge, X, Eye, ShieldAlert, RotateCcw, ChevronRight, Search, Download, FileSpreadsheet, FileText } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({ title: 'Журнал слияний' })

const toast = useToast()

interface MergeItem {
  id: string
  createdAt: string
  action: 'merge' | 'rollback'
  organizationId: string
  organizationName: string | null
  isCrossOrg: boolean
  mergeKind: 'auto' | 'manual'
  score: number | null
  reason: string | null
  signals: any
  rollbackUntil: string | null
  daysUntilExpiry: number
  canRollback: boolean
  isRolledBack: boolean
  primary: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
    mergeStatus: string | null
    fraudFlag: boolean
    exists: boolean
  }
  merged: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
    mergeStatus: string | null
    exists: boolean
  }
  performedBy: { id: string; name: string; email: string } | null
}

// ── Фильтры ────────────────────────────────────────────────────────────────
const status = ref<'active' | 'expired' | 'rolled_back' | 'all'>('active')
const mergeKind = ref<'auto' | 'manual' | 'all'>('all')
// Sprint 4.2 (P3.2): own/cross/all
const orgScope = ref<'own' | 'cross' | 'all'>('all')
const searchInput = ref('')
const debouncedSearch = ref('')
const includeOtherOrgs = ref(true)
const page = ref(1)
const pageSize = 30

let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = val.trim()
    page.value = 1
  }, 300)
})

const query = computed(() => ({
  status: status.value,
  mergeKind: mergeKind.value,
  orgScope: orgScope.value,
  ...(debouncedSearch.value ? { search: debouncedSearch.value } : {}),
  includeOtherOrgs: includeOtherOrgs.value,
  limit: pageSize,
  offset: (page.value - 1) * pageSize,
}))

const { data, status: fetchStatus, refresh } = await useAsyncData(
  'dedup-merges',
  () => $fetch<{ total: number; items: MergeItem[] }>('/api/dedup/merges', { query: query.value }),
  { watch: [query] },
)

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / pageSize)))

// ── Модалка «Детали» ───────────────────────────────────────────────────────
interface MergeDetails {
  id: string
  createdAt: string
  mergeKind: string
  score: number | null
  reason: string | null
  signals: any
  rollbackUntil: string | null
  daysUntilExpiry: number
  canRollback: boolean
  isRolledBack: boolean
  primary: {
    id: string
    before: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null; dateOfBirth: string | null } | null
    current: { firstName: string | null; lastName: string | null; email: string | null; mergeStatus: string; fraudFlag: boolean } | null
  }
  merged: {
    id: string
    before: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null; dateOfBirth: string | null } | null
    current: { firstName: string | null; lastName: string | null; email: string | null; mergeStatus: string } | null
  }
  performedBy: { id: string; name: string; email: string } | null
}

const detailsOpen = ref(false)
const detailsData = ref<MergeDetails | null>(null)
const isLoadingDetails = ref(false)

async function openDetails(id: string) {
  detailsOpen.value = true
  detailsData.value = null
  isLoadingDetails.value = true
  try {
    detailsData.value = await $fetch<MergeDetails>(`/api/dedup/merges/${id}`)
  }
  catch (err: any) {
    toast.error('Не удалось загрузить детали', { message: err.data?.statusMessage })
    detailsOpen.value = false
  }
  finally {
    isLoadingDetails.value = false
  }
}

function closeDetails() {
  detailsOpen.value = false
  detailsData.value = null
}

// ── Хелперы ────────────────────────────────────────────────────────────────
function formatName(c: { firstName: string | null; lastName: string | null; email: string | null; id: string }) {
  const n = [c.lastName, c.firstName].filter(Boolean).join(' ').trim()
  return n || c.email || c.id.slice(0, 8)
}

function formatDate(iso: string | Date | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDateOnly(iso: string | Date | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU')
}

function scoreColor(score: number | null): string {
  if (score === null) return 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'
  if (score >= 95) return 'bg-danger-100 text-danger-700 dark:bg-danger-950 dark:text-danger-400'
  if (score >= 90) return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
  return 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300'
}

function signalsList(signals: any): string {
  const labels: Record<string, string> = { name: 'ФИО', city: 'город', dob: 'дата рожд.', manual: 'ручное' }
  // Поддерживаем оба формата: объект {name:92,city:100} (из дашборда дублей)
  // и массив [{kind:'name',value:'92',score:92}] (как пишется в merge_log).
  if (Array.isArray(signals)) {
    return signals
      .map((s: any) => `${labels[s.kind] ?? s.kind}: ${s.score ?? s.value}`)
      .join(' · ')
  }
  if (signals && typeof signals === 'object') {
    return Object.entries(signals)
      .map(([k, v]) => `${labels[k] ?? k}: ${v}`)
      .join(' · ')
  }
  return ''
}

// ── Модалка «Откатить» ─────────────────────────────────────────────────────
const rollbackOpen = ref(false)
const rollbackTarget = ref<MergeItem | null>(null)
const rollbackReason = ref('')
const isRollingBack = ref(false)

function openRollback(item: MergeItem) {
  rollbackTarget.value = item
  rollbackReason.value = ''
  rollbackOpen.value = true
}

function closeRollback() {
  if (isRollingBack.value) return
  rollbackOpen.value = false
  rollbackTarget.value = null
  rollbackReason.value = ''
}

async function confirmRollback() {
  if (!rollbackTarget.value || isRollingBack.value) return
  const id = rollbackTarget.value.id
  isRollingBack.value = true
  try {
    const result: any = await $fetch(`/api/dedup/merges/${id}/rollback`, {
      method: 'POST',
      body: { reason: rollbackReason.value.trim() || undefined },
    })
    const restored = result?.restored
    const lostApps = result?.applicationsDeleted ?? 0
    let msg = 'Слияние откачено'
    if (restored) {
      const parts: string[] = []
      if (restored.applications) parts.push(`заявок: ${restored.applications}`)
      if (restored.documents) parts.push(`документов: ${restored.documents}`)
      if (restored.identities) parts.push(`идентификаторов: ${restored.identities}`)
      if (restored.stageHistoryRemoved) parts.push(`склеенных записей истории стадий удалено: ${restored.stageHistoryRemoved}`)
      if (parts.length) msg += ` · восстановлено ${parts.join(', ')}`
    }
    if (lostApps > 0) msg += ` · ${lostApps} удалённых заявок восстановить нельзя`
    toast.success?.(msg)
    rollbackOpen.value = false
    rollbackTarget.value = null
    rollbackReason.value = ''
    // Если открыта модалка деталей этого же merge — обновим
    if (detailsData.value && detailsData.value.id === id) {
      closeDetails()
    }
    await refresh()
  }
  catch (err: any) {
    toast.error?.(err.data?.statusMessage || err.message || 'Не удалось откатить слияние')
  }
  finally {
    isRollingBack.value = false
  }
}

// ── Sprint 4.1 (P3.1): экспорт в CSV / XLSX ────────────────────────────────
const isExporting = ref(false)

async function exportMerges(format: 'csv' | 'xlsx') {
  if (isExporting.value) return
  isExporting.value = true
  try {
    const params = new URLSearchParams()
    params.set('format', format)
    params.set('status', status.value)
    params.set('mergeKind', mergeKind.value)
    params.set('orgScope', orgScope.value)
    if (debouncedSearch.value) params.set('search', debouncedSearch.value)
    params.set('includeOtherOrgs', String(includeOtherOrgs.value))

    const res = await fetch(`/api/dedup/merges/export?${params.toString()}`, {
      credentials: 'include',
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition') ?? ''
    const m = cd.match(/filename="([^"]+)"/)
    const fileName = m?.[1] ?? `merges.${format}`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success?.(`Файл ${fileName} скачан`)
  }
  catch (e: any) {
    toast.error?.(e?.message || 'Не удалось экспортировать')
  }
  finally {
    isExporting.value = false
  }
}

function statusBadge(item: MergeItem): { text: string; cls: string } {
  if (item.isRolledBack) {
    return { text: 'Откачено', cls: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400' }
  }
  if (!item.rollbackUntil || item.daysUntilExpiry <= 0) {
    return { text: 'Окно закрыто', cls: 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400' }
  }
  return { text: `${item.daysUntilExpiry} дн. до закрытия`, cls: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400' }
}
</script>

<template>
  <div class="mx-auto max-w-[1400px] px-4 py-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <History class="size-6 text-brand-600" />
        <div>
          <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-50">Журнал слияний</h1>
          <p class="text-sm text-surface-500 dark:text-surface-400">
            История ручных и автоматических слияний кандидатов
          </p>
        </div>
      </div>
      <!-- Экспорт -->
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50"
          :disabled="isExporting"
          title="Скачать журнал в CSV (с учётом текущих фильтров)"
          @click="exportMerges('csv')"
        >
          <FileText class="size-3.5" />
          CSV
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50"
          :disabled="isExporting"
          title="Скачать журнал в Excel (.xlsx)"
          @click="exportMerges('xlsx')"
        >
          <FileSpreadsheet class="size-3.5" />
          XLSX
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50/50 dark:bg-surface-900/50">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-surface-600 dark:text-surface-400">Статус:</span>
        <select
          v-model="status"
          class="text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1"
        >
          <option value="active">Активные (откат возможен)</option>
          <option value="expired">Окно закрыто</option>
          <option value="rolled_back">Откачено</option>
          <option value="all">Все</option>
        </select>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-surface-600 dark:text-surface-400">Тип:</span>
        <select
          v-model="mergeKind"
          class="text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1"
        >
          <option value="all">Все</option>
          <option value="manual">Ручные</option>
          <option value="auto">Авто</option>
        </select>
      </div>
      <!-- Sprint 4.2 (P3.2): область -->
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-surface-600 dark:text-surface-400">Область:</span>
        <select
          v-model="orgScope"
          class="text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1"
        >
          <option value="all">Все</option>
          <option value="own">Своя организация</option>
          <option value="cross">Cross-org</option>
        </select>
      </div>
      <div class="relative">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-surface-400" />
        <input
          v-model="searchInput"
          type="text"
          placeholder="Поиск по ФИО или email"
          class="pl-8 pr-3 py-1 text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 w-64"
        />
      </div>
      <label class="flex items-center gap-2 text-xs text-surface-600 dark:text-surface-400 cursor-pointer">
        <input v-model="includeOtherOrgs" type="checkbox" class="rounded" />
        Вся группа организаций
      </label>
      <div class="ml-auto flex items-center gap-3 text-sm text-surface-500 dark:text-surface-400">
        <div>Всего: <span class="font-semibold text-surface-900 dark:text-surface-50">{{ data?.total ?? 0 }}</span></div>
        <div v-if="totalPages > 1" class="flex items-center gap-1">
          <button
            class="px-2 py-1 text-xs rounded border border-surface-300 dark:border-surface-700 disabled:opacity-40"
            :disabled="page <= 1"
            @click="page--"
          >‹</button>
          <span class="text-xs">{{ page }} / {{ totalPages }}</span>
          <button
            class="px-2 py-1 text-xs rounded border border-surface-300 dark:border-surface-700 disabled:opacity-40"
            :disabled="page >= totalPages"
            @click="page++"
          >›</button>
        </div>
      </div>
    </div>

    <!-- Loading / empty -->
    <div v-if="fetchStatus === 'pending'" class="text-sm text-surface-500 dark:text-surface-400 py-12 text-center">
      Загружаем…
    </div>
    <div
      v-else-if="!data || data.items.length === 0"
      class="rounded-lg border border-dashed border-surface-300 dark:border-surface-700 p-12 text-center"
    >
      <History class="size-10 mx-auto mb-3 text-surface-300 dark:text-surface-600" />
      <p class="text-sm font-medium text-surface-700 dark:text-surface-300">Слияний пока нет</p>
      <p class="text-xs text-surface-500 dark:text-surface-400 mt-1">
        Когда вы сольёте дубли в дашборде или с карточки кандидата, история появится здесь
      </p>
    </div>

    <!-- List -->
    <div v-else class="space-y-2">
      <div
        v-for="item in data.items"
        :key="item.id"
        class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4"
      >
        <div class="flex items-start gap-4">
          <!-- Score -->
          <div class="shrink-0 text-center w-14">
            <div :class="['inline-flex items-center justify-center size-12 rounded-full text-sm font-bold', scoreColor(item.score)]">
              {{ item.score ?? '—' }}
            </div>
          </div>

          <!-- Names -->
          <div class="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
            <div class="min-w-0">
              <NuxtLink
                v-if="item.primary.exists"
                :to="`/dashboard/candidates/${item.primary.id}`"
                class="font-medium text-surface-900 dark:text-surface-50 hover:text-brand-600 dark:hover:text-brand-400 truncate flex items-center gap-1.5"
              >
                {{ formatName(item.primary) }}
                <ShieldAlert v-if="item.primary.fraudFlag" class="size-3.5 text-danger-500" />
              </NuxtLink>
              <span v-else class="font-medium text-surface-400 dark:text-surface-500 truncate italic">
                {{ formatName(item.primary) }} (удалён)
              </span>
              <div class="text-[11px] text-surface-500 dark:text-surface-400 truncate">primary</div>
            </div>

            <ChevronRight class="size-4 text-surface-400 shrink-0" />

            <div class="min-w-0">
              <NuxtLink
                v-if="item.merged.exists"
                :to="`/dashboard/candidates/${item.merged.id}`"
                class="text-surface-700 dark:text-surface-300 hover:text-brand-600 dark:hover:text-brand-400 truncate block"
              >
                {{ formatName(item.merged) }}
              </NuxtLink>
              <span v-else class="text-surface-400 dark:text-surface-500 truncate italic block">
                {{ formatName(item.merged) }} (удалён)
              </span>
              <div class="text-[11px] text-surface-500 dark:text-surface-400 truncate">слит → primary</div>
            </div>
          </div>

          <!-- Meta -->
          <div class="shrink-0 text-right text-xs space-y-1 min-w-[180px]">
            <div class="text-surface-700 dark:text-surface-300">{{ formatDate(item.createdAt) }}</div>
            <div class="text-surface-500 dark:text-surface-400">
              {{ item.performedBy?.name || 'система' }} ·
              <span class="font-medium">{{ item.mergeKind === 'manual' ? 'ручное' : 'авто' }}</span>
            </div>
            <div class="flex flex-wrap justify-end gap-1">
              <!-- Sprint 4.2 (P3.2): бейдж организации -->
              <span
                v-if="item.organizationName"
                :class="[
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                  item.isCrossOrg
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400'
                    : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300',
                ]"
                :title="item.isCrossOrg ? 'Cross-org merge (из другой организации вашей группы)' : 'Собственный merge'"
              >
                {{ item.organizationName }}
              </span>
              <span :class="['inline-block px-2 py-0.5 rounded text-[10px] font-medium', statusBadge(item).cls]">
                {{ statusBadge(item).text }}
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="shrink-0 flex flex-col gap-1.5">
            <button
              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium border border-surface-300 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-200"
              @click="openDetails(item.id)"
            >
              <Eye class="size-3.5" />
              Подробнее
            </button>
            <button
              :disabled="!item.canRollback"
              :title="item.canRollback ? 'Откатить слияние' : (item.isRolledBack ? 'Уже откачено' : 'Окно отката закрыто')"
              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              @click="openRollback(item)"
            >
              <RotateCcw class="size-3.5" />
              Откатить
            </button>
          </div>
        </div>

        <!-- Signals + reason -->
        <div class="mt-2 pl-[72px] text-xs text-surface-500 dark:text-surface-400 space-y-0.5">
          <div v-if="item.signals && (Array.isArray(item.signals) ? item.signals.length : Object.keys(item.signals).length)">{{ signalsList(item.signals) }}</div>
          <div v-if="item.reason" class="italic">«{{ item.reason }}»</div>
        </div>
      </div>
    </div>

    <!-- Details modal -->
    <Teleport to="body">
      <div
        v-if="detailsOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        @click.self="closeDetails"
      >
        <div class="w-full max-w-3xl rounded-xl bg-white dark:bg-surface-900 shadow-2xl border border-surface-200 dark:border-surface-800 flex flex-col max-h-[90vh]">
          <div class="px-6 py-4 border-b border-surface-200 dark:border-surface-800 flex items-center justify-between shrink-0">
            <div class="flex items-center gap-2">
              <GitMerge class="size-5 text-brand-600" />
              <h2 class="text-base font-semibold text-surface-900 dark:text-surface-50">
                Детали слияния
              </h2>
            </div>
            <button class="rounded-md p-1 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200" @click="closeDetails">
              <X class="size-5" />
            </button>
          </div>

          <div v-if="isLoadingDetails" class="p-8 text-center text-sm text-surface-500">
            Загружаем…
          </div>

          <div v-else-if="detailsData" class="p-6 space-y-4 overflow-y-auto flex-1">
            <!-- Meta -->
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div class="text-xs text-surface-500 dark:text-surface-400">Дата</div>
                <div class="text-surface-900 dark:text-surface-50">{{ formatDate(detailsData.createdAt) }}</div>
              </div>
              <div>
                <div class="text-xs text-surface-500 dark:text-surface-400">Выполнил</div>
                <div class="text-surface-900 dark:text-surface-50">{{ detailsData.performedBy?.name || 'система' }}</div>
              </div>
              <div>
                <div class="text-xs text-surface-500 dark:text-surface-400">Тип</div>
                <div class="text-surface-900 dark:text-surface-50">{{ detailsData.mergeKind === 'manual' ? 'Ручное' : 'Автоматическое' }}</div>
              </div>
              <div>
                <div class="text-xs text-surface-500 dark:text-surface-400">Скор</div>
                <div :class="['inline-flex px-2 py-0.5 rounded text-sm font-bold', scoreColor(detailsData.score)]">
                  {{ detailsData.score ?? '—' }}
                </div>
              </div>
              <div v-if="detailsData.signals && (Array.isArray(detailsData.signals) ? detailsData.signals.length : Object.keys(detailsData.signals).length)" class="col-span-2">
                <div class="text-xs text-surface-500 dark:text-surface-400">Сигналы</div>
                <div class="text-surface-700 dark:text-surface-300">{{ signalsList(detailsData.signals) }}</div>
              </div>
              <div v-if="detailsData.reason" class="col-span-2">
                <div class="text-xs text-surface-500 dark:text-surface-400">Причина</div>
                <div class="text-surface-700 dark:text-surface-300 italic">«{{ detailsData.reason }}»</div>
              </div>
            </div>

            <!-- Rollback status -->
            <div
              :class="[
                'p-3 rounded-lg text-xs',
                detailsData.isRolledBack
                  ? 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300'
                  : detailsData.canRollback
                    ? 'bg-brand-50 dark:bg-brand-950/30 text-brand-800 dark:text-brand-300 border border-brand-200 dark:border-brand-900'
                    : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400',
              ]"
            >
              <template v-if="detailsData.isRolledBack">
                Это слияние было откачено
              </template>
              <template v-else-if="detailsData.canRollback">
                Откат возможен до {{ formatDateOnly(detailsData.rollbackUntil) }} (осталось {{ detailsData.daysUntilExpiry }} дн.)
              </template>
              <template v-else>
                Окно отката закрыто {{ formatDateOnly(detailsData.rollbackUntil) }}
              </template>
            </div>

            <!-- Side-by-side snapshot -->
            <div>
              <div class="text-xs font-semibold text-surface-700 dark:text-surface-300 mb-2">Состояние ДО слияния</div>
              <div class="grid grid-cols-2 gap-3">
                <div class="rounded-lg border-2 border-brand-500 bg-brand-50/30 dark:bg-brand-950/20 p-3 text-xs space-y-1">
                  <div class="font-semibold text-brand-700 dark:text-brand-400 mb-1">PRIMARY (остался)</div>
                  <div v-if="detailsData.primary.before">
                    <div><span class="text-surface-500">ФИО:</span> {{ [detailsData.primary.before.lastName, detailsData.primary.before.firstName].filter(Boolean).join(' ') || '—' }}</div>
                    <div><span class="text-surface-500">Email:</span> {{ detailsData.primary.before.email || '—' }}</div>
                    <div><span class="text-surface-500">Телефон:</span> {{ detailsData.primary.before.phone || '—' }}</div>
                    <div><span class="text-surface-500">Дата рожд.:</span> {{ detailsData.primary.before.dateOfBirth || '—' }}</div>
                  </div>
                  <div v-else class="text-surface-400 italic">снимок недоступен</div>
                  <NuxtLink
                    v-if="detailsData.primary.current"
                    :to="`/dashboard/candidates/${detailsData.primary.id}`"
                    target="_blank"
                    class="inline-block text-brand-600 dark:text-brand-400 hover:underline pt-1"
                  >
                    Открыть текущую карточку →
                  </NuxtLink>
                </div>

                <div class="rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 p-3 text-xs space-y-1">
                  <div class="font-semibold text-surface-600 dark:text-surface-400 mb-1">MERGED (слит)</div>
                  <div v-if="detailsData.merged.before">
                    <div><span class="text-surface-500">ФИО:</span> {{ [detailsData.merged.before.lastName, detailsData.merged.before.firstName].filter(Boolean).join(' ') || '—' }}</div>
                    <div><span class="text-surface-500">Email:</span> {{ detailsData.merged.before.email || '—' }}</div>
                    <div><span class="text-surface-500">Телефон:</span> {{ detailsData.merged.before.phone || '—' }}</div>
                    <div><span class="text-surface-500">Дата рожд.:</span> {{ detailsData.merged.before.dateOfBirth || '—' }}</div>
                  </div>
                  <div v-else class="text-surface-400 italic">снимок недоступен</div>
                  <NuxtLink
                    v-if="detailsData.merged.current"
                    :to="`/dashboard/candidates/${detailsData.merged.id}`"
                    target="_blank"
                    class="inline-block text-brand-600 dark:text-brand-400 hover:underline pt-1"
                  >
                    Открыть карточку слитого →
                  </NuxtLink>
                </div>
              </div>
            </div>
          </div>

          <div class="px-6 py-3 border-t border-surface-200 dark:border-surface-800 flex justify-end gap-2 shrink-0">
            <button
              v-if="detailsData?.canRollback"
              class="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950"
              @click="() => { if (detailsData) { const item = data?.items.find(i => i.id === detailsData!.id); if (item) openRollback(item) } }"
            >
              <RotateCcw class="size-4" />
              Откатить слияние
            </button>
            <button
              class="rounded-md px-4 py-2 text-sm font-medium border border-surface-300 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-200"
              @click="closeDetails"
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Rollback confirmation modal -->
    <Teleport to="body">
      <div
        v-if="rollbackOpen"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        @click.self="closeRollback"
      >
        <div class="w-full max-w-lg rounded-xl bg-white dark:bg-surface-900 shadow-2xl border border-surface-200 dark:border-surface-800">
          <div class="px-6 py-4 border-b border-surface-200 dark:border-surface-800 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <RotateCcw class="size-5 text-amber-600" />
              <h2 class="text-base font-semibold text-surface-900 dark:text-surface-50">Откатить слияние?</h2>
            </div>
            <button
              class="rounded-md p-1 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 disabled:opacity-40"
              :disabled="isRollingBack"
              @click="closeRollback"
            >
              <X class="size-5" />
            </button>
          </div>

          <div class="p-6 space-y-4 text-sm">
            <p class="text-surface-700 dark:text-surface-200">
              Кандидат <span class="font-medium">{{ rollbackTarget ? formatName(rollbackTarget.merged) : '' }}</span>
              будет восстановлен как отдельный, а связи (заявки, документы, идентификаторы) вернутся к нему.
            </p>

            <div class="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
              <div class="font-semibold">⚠️ Важно</div>
              <ul class="list-disc pl-4 space-y-0.5">
                <li>Заявки, которые при слиянии были удалены как дубликаты, восстановить нельзя.</li>
                <li>Откат пишется в журнал отдельной записью — повторно откатить эту пару нельзя.</li>
                <li>Пара вернётся в очередь дублей со статусом «pending».</li>
              </ul>
            </div>

            <div>
              <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">
                Причина отката (необязательно)
              </label>
              <textarea
                v-model="rollbackReason"
                rows="2"
                maxlength="500"
                placeholder="Например: ошибочное слияние, разные люди"
                class="w-full text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                :disabled="isRollingBack"
              />
            </div>
          </div>

          <div class="px-6 py-3 border-t border-surface-200 dark:border-surface-800 flex justify-end gap-2">
            <button
              class="rounded-md px-4 py-2 text-sm font-medium border border-surface-300 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-200 disabled:opacity-40"
              :disabled="isRollingBack"
              @click="closeRollback"
            >
              Отмена
            </button>
            <button
              class="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="isRollingBack"
              @click="confirmRollback"
            >
              <RotateCcw v-if="!isRollingBack" class="size-4" />
              <svg v-else class="animate-spin size-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              {{ isRollingBack ? 'Откатываем…' : 'Откатить' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
