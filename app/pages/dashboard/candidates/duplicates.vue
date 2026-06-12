<script setup lang="ts">
import { Users, AlertTriangle, ChevronRight, X, Check, ShieldAlert, Briefcase, Sparkles, Loader2 } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({ title: 'Дубли кандидатов' })

const toast = useToast()

interface DupCandidate {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  dateOfBirth: string | null
  city: string | null
  linkedin: string | null
  telegram: string | null
  github: string | null
  organizationId: string
  fraudFlag: boolean
  activeApplications: number
}

// Sprint 4.5 (P3.5): поля для сравнения в merge-модалке
const COMPARE_FIELDS: Array<{ key: keyof DupCandidate; label: string }> = [
  { key: 'lastName', label: 'Фамилия' },
  { key: 'firstName', label: 'Имя' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Телефон' },
  { key: 'dateOfBirth', label: 'Дата рождения' },
  { key: 'city', label: 'Город' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'github', label: 'GitHub' },
]
function fieldsDiffer(a: DupCandidate, b: DupCandidate, key: keyof DupCandidate): boolean {
  const va = (a[key] ?? '') as string
  const vb = (b[key] ?? '') as string
  // Различие — если оба непусты и не равны (case-insensitive). Пустое ≃ любое — не различие (добавляемые данные).
  if (!va.trim() || !vb.trim()) return false
  return va.trim().toLowerCase() !== vb.trim().toLowerCase()
}
interface DupPair {
  id: string
  score: number
  signals: Record<string, number>
  status: string
  createdAt: string
  // Sprint 5.2 (P5.2): AI-арбитр
  aiVerdict: 'same' | 'different' | 'unsure' | null
  aiConfidence: number | null
  aiReasoning: string | null
  aiCheckedAt: string | null
  candidateA: DupCandidate
  candidateB: DupCandidate
}

// ── Фильтры ─────────────────────────────────────────────────────────────────
type SortOption = 'score_desc' | 'score_asc' | 'newest' | 'oldest' | 'fraud_first' | 'active_apps_desc'
const status = ref<'pending' | 'dismissed' | 'merged'>('pending')
const minScore = ref<number | undefined>(undefined)
const includeOtherOrgs = ref(true)
const sort = ref<SortOption>('score_desc')

const query = computed(() => ({
  status: status.value,
  limit: 100,
  offset: 0,
  ...(minScore.value !== undefined ? { minScore: minScore.value } : {}),
  includeOtherOrgs: includeOtherOrgs.value,
  sort: sort.value,
}))

const { data, status: fetchStatus, refresh } = await useAsyncData(
  'dedup-duplicates',
  () => $fetch<{ total: number; items: DupPair[] }>('/api/dedup/duplicates', { query: query.value }),
  { watch: [query] },
)

// ── Модалка слияния ─────────────────────────────────────────────────────────
const mergeModalOpen = ref(false)
const activePair = ref<DupPair | null>(null)
const selectedPrimaryId = ref<string | null>(null)
const isMerging = ref(false)
const mergeReason = ref('')

function openMerge(pair: DupPair) {
  activePair.value = pair
  // По умолчанию primary = тот, у кого нет фрод-флага и больше «вес»
  // Простая эвристика: если у одного фрод — primary тот, у кого нет.
  if (pair.candidateA.fraudFlag && !pair.candidateB.fraudFlag) {
    selectedPrimaryId.value = pair.candidateB.id
  }
  else if (pair.candidateB.fraudFlag && !pair.candidateA.fraudFlag) {
    selectedPrimaryId.value = pair.candidateA.id
  }
  else {
    selectedPrimaryId.value = pair.candidateA.id
  }
  mergeReason.value = ''
  mergeModalOpen.value = true
}

function closeMerge() {
  mergeModalOpen.value = false
  activePair.value = null
  selectedPrimaryId.value = null
  isMerging.value = false
}

async function submitMerge() {
  if (!activePair.value || !selectedPrimaryId.value || isMerging.value) return
  isMerging.value = true
  try {
    const res = await $fetch<{
      ok: true
      transferred: { applications: number; applicationsDeletedAsDuplicates: number; documents: number; identities: number; resumeVersions: number }
    }>(`/api/dedup/duplicates/${activePair.value.id}/merge`, {
      method: 'POST',
      body: {
        primaryCandidateId: selectedPrimaryId.value,
        reason: mergeReason.value.trim() || undefined,
      },
    })
    toast.success?.(
      `Кандидаты слиты — заявок ${res.transferred.applications}, документов ${res.transferred.documents}, идентификаторов ${res.transferred.identities}`,
    )
    closeMerge()
    await refresh()
  }
  catch (err: any) {
    toast.error('Не удалось слить', { message: err.data?.statusMessage || err.message })
  }
  finally {
    isMerging.value = false
  }
}

// ── Dismiss ────────────────────────────────────────────────────────────────
async function dismissPair(pair: DupPair) {
  if (!confirm(`Отклонить пару (это не дубль)?\n${formatName(pair.candidateA)} ↔ ${formatName(pair.candidateB)}`)) return
  try {
    await $fetch(`/api/dedup/duplicates/${pair.id}/dismiss`, { method: 'POST' })
    toast.success?.('Пара отклонена')
    await refresh()
  }
  catch (err: any) {
    toast.error('Не удалось отклонить', { message: err.data?.statusMessage })
  }
}

function formatName(c: DupCandidate): string {
  const name = [c.lastName, c.firstName].filter(Boolean).join(' ').trim()
  return name || c.email || c.id.slice(0, 8)
}

function scoreColor(score: number): string {
  if (score >= 95) return 'bg-danger-100 text-danger-700 dark:bg-danger-950 dark:text-danger-400'
  if (score >= 90) return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
  return 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300'
}

// ── Sprint 5.1 (P5.3): Batch-merge N кандидатов ───────────────────────────
const batchMode = ref(false)
const selectedPairIds = ref<Set<string>>(new Set())
const batchModalOpen = ref(false)
const batchPrimaryId = ref<string | null>(null)
const batchReason = ref('')
const isBatchMerging = ref(false)

function togglePairSelection(pairId: string) {
  if (selectedPairIds.value.has(pairId)) selectedPairIds.value.delete(pairId)
  else selectedPairIds.value.add(pairId)
  // реактивность Set в Vue: пересоздаём
  selectedPairIds.value = new Set(selectedPairIds.value)
}

function toggleBatchMode() {
  batchMode.value = !batchMode.value
  if (!batchMode.value) selectedPairIds.value = new Set()
}

// Собираем уникальных кандидатов из выбранных пар (ракоход по A и B)
const selectedCandidates = computed(() => {
  if (!data.value) return [] as DupCandidate[]
  const map = new Map<string, DupCandidate>()
  for (const pair of data.value.items) {
    if (!selectedPairIds.value.has(pair.id)) continue
    if (!map.has(pair.candidateA.id)) map.set(pair.candidateA.id, pair.candidateA)
    if (!map.has(pair.candidateB.id)) map.set(pair.candidateB.id, pair.candidateB)
  }
  return Array.from(map.values())
})

function openBatchModal() {
  if (selectedCandidates.value.length < 3) {
    toast.error?.('Выберите пары, в которых всего больше 2 разных кандидатов (иначе проще обычное слияние)')
    return
  }
  batchPrimaryId.value = selectedCandidates.value[0]?.id ?? null
  batchReason.value = ''
  batchModalOpen.value = true
}

function closeBatchModal() {
  batchModalOpen.value = false
  isBatchMerging.value = false
}

async function submitBatchMerge() {
  if (!batchPrimaryId.value || isBatchMerging.value) return
  const mergedIds = selectedCandidates.value
    .map(c => c.id)
    .filter(id => id !== batchPrimaryId.value)
  if (mergedIds.length === 0) return
  isBatchMerging.value = true
  try {
    const res = await $fetch<{
      ok: boolean
      totalRequested: number
      totalMerged: number
      totalFailed: number
      details: Array<{ mergedCandidateId: string, ok: boolean, error?: string }>
    }>(`/api/candidates/${batchPrimaryId.value}/merge-batch`, {
      method: 'POST',
      body: { mergedCandidateIds: mergedIds, reason: batchReason.value.trim() || undefined },
    })
    if (res.ok) {
      toast.success?.(`Слито ${res.totalMerged} кандидатов в одного`)
    }
    else {
      toast.error(`Частичный успех: ${res.totalMerged} слито, ${res.totalFailed} ошибок`, { message: res.details.filter(d => !d.ok).map(d => d.error).join('; ') })
    }
    closeBatchModal()
    batchMode.value = false
    selectedPairIds.value = new Set()
    await refresh()
  }
  catch (err: any) {
    toast.error('Не удалось выполнить пакетное слияние', { message: err.data?.statusMessage || err.message })
  }
  finally {
    isBatchMerging.value = false
  }
}

// ── Sprint 5.2 (P5.2): AI-арбитр ─────────────────────────────
const arbitratingPairId = ref<string | null>(null)
const isBatchArbitrating = ref(false)

async function arbitratePair(pair: DupPair) {
  if (arbitratingPairId.value) return
  arbitratingPairId.value = pair.id
  try {
    const r = await $fetch<{ verdict: string, confidence: number, reasoning: string }>(
      `/api/dedup/duplicates/${pair.id}/ai-arbitrate`,
      { method: 'POST', body: { force: !!pair.aiVerdict } },
    )
    const labels: Record<string, string> = { same: 'Один и тот же', different: 'Разные', unsure: 'Неуверен' }
    toast.success?.(`AI: ${labels[r.verdict] ?? r.verdict} (уверенность ${r.confidence}%)`)
    await refresh()
  }
  catch (err: any) {
    toast.error('Не удалось вызвать AI-арбитра', { message: err.data?.statusMessage || err.message })
  }
  finally {
    arbitratingPairId.value = null
  }
}

async function arbitrateBatch() {
  if (isBatchArbitrating.value) return
  if (!confirm('Запустить AI-арбитра для всех непроверенных пар в зоне 85–94?\n\nЭто потратит токены организации.')) return
  isBatchArbitrating.value = true
  try {
    const r = await $fetch<{ ok: boolean, totalArbitrated: number, totalFailed: number, totalRequested: number }>(
      '/api/dedup/ai-arbitrate-batch',
      { method: 'POST', body: { limit: 20 } },
    )
    if (r.totalRequested === 0) {
      toast.success?.('Нет пар для арбитража')
    }
    else if (r.ok) {
      toast.success?.(`AI-арбитраж: ${r.totalArbitrated} пар проверено`)
    }
    else {
      toast.error(`Частичный успех: ${r.totalArbitrated}/${r.totalRequested}, ошибок ${r.totalFailed}`)
    }
    await refresh()
  }
  catch (err: any) {
    toast.error('Не удалось запустить арбитраж', { message: err.data?.statusMessage || err.message })
  }
  finally {
    isBatchArbitrating.value = false
  }
}

function verdictBadge(v: string | null): { text: string, cls: string } | null {
  if (!v) return null
  if (v === 'same') return { text: 'AI: один и тот же', cls: 'bg-danger-100 dark:bg-danger-950 text-danger-700 dark:text-danger-400' }
  if (v === 'different') return { text: 'AI: разные', cls: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400' }
  return { text: 'AI: неуверен', cls: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400' }
}

function signalsList(signals: Record<string, number>): string {
  const labels: Record<string, string> = { name: 'ФИО', city: 'город', dob: 'дата рожд.' }
  return Object.entries(signals)
    .map(([k, v]) => `${labels[k] ?? k}: ${v}`)
    .join(' · ')
}
</script>

<template>
  <div class="mx-auto max-w-[1400px] px-4 py-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <Users class="size-6 text-brand-600" />
        <div>
          <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-50">Дубли кандидатов</h1>
          <p class="text-sm text-surface-500 dark:text-surface-400">
            Очередь пар по fuzzy-сигналам (порог 85, рекомендация к слиянию от 95)
          </p>
        </div>
      </div>
      <div v-if="status === 'pending'" class="flex items-center gap-2">
        <!-- Sprint 5.2: AI-арбитраж всех непроверенных -->
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-purple-300 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/40 text-purple-700 dark:text-purple-300 disabled:opacity-50"
          :disabled="isBatchArbitrating"
          @click="arbitrateBatch"
        >
          <Loader2 v-if="isBatchArbitrating" class="size-3.5 animate-spin" />
          <Sparkles v-else class="size-3.5" />
          {{ isBatchArbitrating ? 'Проверяем…' : 'AI-арбитр для всех' }}
        </button>
        <!-- Sprint 5.1: переключатель режима батч-слияния -->
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border"
          :class="batchMode
            ? 'bg-brand-600 hover:bg-brand-700 text-white border-brand-600'
            : 'border-surface-300 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-200'"
          @click="toggleBatchMode"
        >
          <Check v-if="batchMode" class="size-3.5" />
          {{ batchMode ? 'Режим объединения включён' : 'Объединить нескольких' }}
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
          <option value="pending">Ожидают</option>
          <option value="dismissed">Отклонённые</option>
          <option value="merged">Слитые</option>
        </select>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-surface-600 dark:text-surface-400">Скор ≥</span>
        <select
          v-model.number="minScore"
          class="text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1"
        >
          <option :value="undefined">все (85+)</option>
          <option :value="90">90+</option>
          <option :value="95">95+ (рекомендация)</option>
        </select>
      </div>
      <label class="flex items-center gap-2 text-xs text-surface-600 dark:text-surface-400 cursor-pointer">
        <input v-model="includeOtherOrgs" type="checkbox" class="rounded" />
        Включая другие организации группы
      </label>
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-surface-600 dark:text-surface-400">Сортировка:</span>
        <select
          v-model="sort"
          class="text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1"
        >
          <option value="score_desc">Скор ↓</option>
          <option value="score_asc">Скор ↑</option>
          <option value="newest">Сначала новые</option>
          <option value="oldest">Сначала старые</option>
          <option value="fraud_first">Сначала с фрод-флагом</option>
          <option value="active_apps_desc">Сначала с активными заявками</option>
        </select>
      </div>
      <div class="ml-auto text-sm text-surface-500 dark:text-surface-400">
        Найдено: <span class="font-semibold text-surface-900 dark:text-surface-50">{{ data?.total ?? 0 }}</span>
      </div>
    </div>

    <!-- Empty / loading -->
    <div v-if="fetchStatus === 'pending'" class="text-sm text-surface-500 dark:text-surface-400 py-12 text-center">
      Загружаем…
    </div>
    <div
      v-else-if="!data || data.items.length === 0"
      class="rounded-lg border border-dashed border-surface-300 dark:border-surface-700 p-12 text-center"
    >
      <Users class="size-10 mx-auto mb-3 text-surface-300 dark:text-surface-600" />
      <p class="text-sm font-medium text-surface-700 dark:text-surface-300">Пар нет</p>
      <p class="text-xs text-surface-500 dark:text-surface-400 mt-1">
        Все обработано или fuzzy-матчинг пока не нашёл совпадений
      </p>
    </div>

    <!-- Table of pairs -->
    <div v-else class="space-y-2">
      <div
        v-for="pair in data.items"
        :key="pair.id"
        class="rounded-lg border bg-white dark:bg-surface-900 p-4"
        :class="batchMode && selectedPairIds.has(pair.id)
          ? 'border-brand-500 ring-2 ring-brand-200 dark:ring-brand-900'
          : 'border-surface-200 dark:border-surface-800'"
      >
        <div class="flex items-start gap-4">
          <!-- Sprint 5.1: чекбокс выбора пары -->
          <label
            v-if="batchMode && pair.status === 'pending'"
            class="shrink-0 mt-3 cursor-pointer"
          >
            <input
              type="checkbox"
              :checked="selectedPairIds.has(pair.id)"
              class="size-4 rounded"
              @change="togglePairSelection(pair.id)"
            />
          </label>
          <!-- Score badge -->
          <div class="shrink-0 text-center">
            <div :class="['inline-flex items-center justify-center size-12 rounded-full text-sm font-bold', scoreColor(pair.score)]">
              {{ pair.score }}
            </div>
            <div v-if="pair.score >= 95" class="text-[10px] font-medium text-danger-600 dark:text-danger-400 mt-1">
              реком.
            </div>
          </div>

          <!-- Candidate A -->
          <div class="flex-1 min-w-0">
            <NuxtLink
              :to="`/dashboard/candidates/${pair.candidateA.id}`"
              class="font-medium text-surface-900 dark:text-surface-50 hover:text-brand-600 dark:hover:text-brand-400 truncate flex items-center gap-2"
            >
              {{ formatName(pair.candidateA) }}
              <span
                v-if="pair.candidateA.fraudFlag"
                class="inline-flex items-center gap-1 rounded-full bg-danger-100 dark:bg-danger-950 text-danger-700 dark:text-danger-400 px-1.5 py-0.5 text-[10px] font-medium"
                title="Фрод-флаг"
              >
                <ShieldAlert class="size-3" /> фрод
              </span>
              <span
                v-if="pair.candidateA.activeApplications > 0"
                class="inline-flex items-center gap-1 rounded-full bg-brand-100 dark:bg-brand-950 text-brand-700 dark:text-brand-400 px-1.5 py-0.5 text-[10px] font-medium"
                :title="`Активных заявок: ${pair.candidateA.activeApplications}`"
              >
                <Briefcase class="size-3" /> {{ pair.candidateA.activeApplications }}
              </span>
            </NuxtLink>
            <div v-if="pair.candidateA.email" class="text-xs text-surface-500 dark:text-surface-400 truncate">
              {{ pair.candidateA.email }}
            </div>
          </div>

          <ChevronRight class="size-4 text-surface-400 shrink-0 mt-2" />

          <!-- Candidate B -->
          <div class="flex-1 min-w-0">
            <NuxtLink
              :to="`/dashboard/candidates/${pair.candidateB.id}`"
              class="font-medium text-surface-900 dark:text-surface-50 hover:text-brand-600 dark:hover:text-brand-400 truncate flex items-center gap-2"
            >
              {{ formatName(pair.candidateB) }}
              <span
                v-if="pair.candidateB.fraudFlag"
                class="inline-flex items-center gap-1 rounded-full bg-danger-100 dark:bg-danger-950 text-danger-700 dark:text-danger-400 px-1.5 py-0.5 text-[10px] font-medium"
                title="Фрод-флаг"
              >
                <ShieldAlert class="size-3" /> фрод
              </span>
              <span
                v-if="pair.candidateB.activeApplications > 0"
                class="inline-flex items-center gap-1 rounded-full bg-brand-100 dark:bg-brand-950 text-brand-700 dark:text-brand-400 px-1.5 py-0.5 text-[10px] font-medium"
                :title="`Активных заявок: ${pair.candidateB.activeApplications}`"
              >
                <Briefcase class="size-3" /> {{ pair.candidateB.activeApplications }}
              </span>
            </NuxtLink>
            <div v-if="pair.candidateB.email" class="text-xs text-surface-500 dark:text-surface-400 truncate">
              {{ pair.candidateB.email }}
            </div>
          </div>

          <!-- Actions -->
          <div v-if="pair.status === 'pending'" class="flex items-center gap-2 shrink-0">
            <button
              class="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium border border-surface-300 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-200"
              @click="dismissPair(pair)"
            >
              <X class="size-3.5" />
              Не дубль
            </button>
            <button
              class="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white"
              @click="openMerge(pair)"
            >
              <Check class="size-3.5" />
              Слить
            </button>
          </div>
          <div v-else class="text-xs text-surface-400 dark:text-surface-500 shrink-0">
            {{ pair.status === 'merged' ? 'Слито' : 'Отклонено' }}
          </div>
        </div>

        <!-- Signals + AI verdict -->
        <div class="mt-2 pl-16 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-500 dark:text-surface-400">
          <span>{{ signalsList(pair.signals) }}</span>
          <!-- Sprint 5.2: AI-вердикт + кнопка запуска -->
          <template v-if="pair.status === 'pending'">
            <span
              v-if="verdictBadge(pair.aiVerdict)"
              :class="['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', verdictBadge(pair.aiVerdict)!.cls]"
              :title="pair.aiReasoning || ''"
            >
              <Sparkles class="size-3" />
              {{ verdictBadge(pair.aiVerdict)!.text }}
              <span v-if="pair.aiConfidence !== null" class="opacity-70">· {{ pair.aiConfidence }}%</span>
            </span>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 disabled:opacity-50"
              :disabled="arbitratingPairId === pair.id"
              :title="pair.aiVerdict ? 'Переспросить AI' : 'Спросить AI'"
              @click="arbitratePair(pair)"
            >
              <Loader2 v-if="arbitratingPairId === pair.id" class="size-3 animate-spin" />
              <Sparkles v-else class="size-3" />
              {{ pair.aiVerdict ? 'Переспросить AI' : 'Спросить AI' }}
            </button>
          </template>
        </div>
        <!-- Sprint 5.2: reasoning AI под парой -->
        <div
          v-if="pair.aiReasoning && pair.status === 'pending'"
          class="mt-2 ml-16 rounded-md bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900 px-3 py-1.5 text-[11px] text-purple-900 dark:text-purple-200"
        >
          <span class="font-semibold">AI:</span> {{ pair.aiReasoning }}
        </div>
      </div>
    </div>

    <!-- Sprint 5.1: Sticky footer для batch-mode -->
    <div
      v-if="batchMode && selectedPairIds.size > 0"
      class="sticky bottom-4 mt-4 rounded-lg bg-brand-600 text-white p-3 flex items-center justify-between shadow-lg z-20"
    >
      <div class="text-sm">
        Выбрано пар: <span class="font-semibold">{{ selectedPairIds.size }}</span>
        · уникальных кандидатов: <span class="font-semibold">{{ selectedCandidates.length }}</span>
      </div>
      <button
        type="button"
        class="rounded-md bg-white text-brand-700 hover:bg-surface-50 px-4 py-1.5 text-sm font-medium disabled:opacity-50"
        :disabled="selectedCandidates.length < 3"
        @click="openBatchModal"
      >
        Слить в одного
      </button>
    </div>

    <!-- Sprint 5.1: Batch-merge modal -->
    <Teleport to="body">
      <div
        v-if="batchModalOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        @click.self="closeBatchModal"
      >
        <div class="w-full max-w-3xl rounded-xl bg-white dark:bg-surface-900 shadow-2xl border border-surface-200 dark:border-surface-800 max-h-[90vh] flex flex-col">
          <div class="px-6 py-4 border-b border-surface-200 dark:border-surface-800">
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-50">
              Пакетное слияние N кандидатов в одного
            </h2>
            <p class="text-xs text-surface-500 dark:text-surface-400 mt-1">
              Выберите primary — того, кто останется. Остальные ({{ selectedCandidates.length - 1 }}) будут последовательно слиты в primary. Каждое слияние можно откатить отдельно через журнал в течение 30 дней.
            </p>
          </div>

          <div class="p-6 space-y-4 overflow-y-auto flex-1">
            <div class="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900">
              <AlertTriangle class="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div class="text-xs text-amber-800 dark:text-amber-300">
                Будет выполнено {{ selectedCandidates.length - 1 }} последовательных слияний. При ошибке на одном из шагов остальные продолжат выполняться (partial success).
              </div>
            </div>

            <div>
              <div class="text-xs font-medium text-surface-600 dark:text-surface-400 mb-2">
                Выбрать primary ({{ selectedCandidates.length }} кандидатов):
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto pr-1">
                <label
                  v-for="cand in selectedCandidates"
                  :key="cand.id"
                  :class="[
                    'rounded-lg border-2 p-3 cursor-pointer transition-colors',
                    batchPrimaryId === cand.id
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                      : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600',
                  ]"
                >
                  <input
                    v-model="batchPrimaryId"
                    type="radio"
                    :value="cand.id"
                    class="sr-only"
                  />
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-[10px] font-medium uppercase tracking-wide" :class="batchPrimaryId === cand.id ? 'text-brand-600 dark:text-brand-400' : 'text-surface-400 dark:text-surface-500'">
                      {{ batchPrimaryId === cand.id ? 'Primary' : 'Будет слит' }}
                    </span>
                    <ShieldAlert v-if="cand.fraudFlag" class="size-3.5 text-danger-500" />
                  </div>
                  <div class="font-medium text-sm text-surface-900 dark:text-surface-50 truncate">
                    {{ formatName(cand) }}
                  </div>
                  <div v-if="cand.email" class="text-xs text-surface-500 dark:text-surface-400 truncate">
                    {{ cand.email }}
                  </div>
                  <div v-if="cand.activeApplications > 0" class="text-[10px] text-brand-600 dark:text-brand-400 mt-1 flex items-center gap-1">
                    <Briefcase class="size-3" /> Активных заявок: {{ cand.activeApplications }}
                  </div>
                </label>
              </div>
            </div>

            <div>
              <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                Причина (опционально, общая для всех слияний)
              </label>
              <textarea
                v-model="batchReason"
                rows="2"
                placeholder="Например: один и тот же кандидат с резюме из разных источников"
                class="w-full text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2"
              />
            </div>
          </div>

          <div class="px-6 py-3 border-t border-surface-200 dark:border-surface-800 flex justify-end gap-2">
            <button
              class="rounded-md px-4 py-2 text-sm font-medium border border-surface-300 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-200"
              :disabled="isBatchMerging"
              @click="closeBatchModal"
            >
              Отмена
            </button>
            <button
              class="rounded-md px-4 py-2 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
              :disabled="isBatchMerging || !batchPrimaryId"
              @click="submitBatchMerge"
            >
              {{ isBatchMerging ? 'Сливаем…' : `Подтвердить слияние ${selectedCandidates.length}→1` }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Merge modal -->
    <Teleport to="body">
      <div
        v-if="mergeModalOpen && activePair"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        @click.self="closeMerge"
      >
        <div class="w-full max-w-2xl rounded-xl bg-white dark:bg-surface-900 shadow-2xl border border-surface-200 dark:border-surface-800">
          <div class="px-6 py-4 border-b border-surface-200 dark:border-surface-800">
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-50">Слияние кандидатов</h2>
            <p class="text-xs text-surface-500 dark:text-surface-400 mt-1">
              Выберите того, кто останется как primary. Второй будет помечен как слитый, его заявки, документы и идентификаторы перейдут к primary.
            </p>
          </div>

          <div class="p-6 space-y-4">
            <!-- Warning -->
            <div class="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900">
              <AlertTriangle class="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div class="text-xs text-amber-800 dark:text-amber-300">
                Слияние можно откатить в течение 30 дней через журнал. После — данные сольются окончательно.
              </div>
            </div>

            <!-- Sprint 4.5: Сравнение полей с подсветкой различий -->
            <div class="rounded-lg border border-surface-200 dark:border-surface-800 overflow-hidden">
              <div class="grid grid-cols-[140px_1fr_1fr] text-xs font-medium bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-800">
                <div class="px-3 py-2 text-surface-500 dark:text-surface-400">Поле</div>
                <div class="px-3 py-2 text-surface-700 dark:text-surface-300 truncate">{{ formatName(activePair.candidateA) }}</div>
                <div class="px-3 py-2 text-surface-700 dark:text-surface-300 truncate">{{ formatName(activePair.candidateB) }}</div>
              </div>
              <div
                v-for="f in COMPARE_FIELDS"
                :key="f.key"
                class="grid grid-cols-[140px_1fr_1fr] text-xs border-t border-surface-100 dark:border-surface-800/60"
                :class="fieldsDiffer(activePair.candidateA, activePair.candidateB, f.key) ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''"
              >
                <div class="px-3 py-1.5 text-surface-500 dark:text-surface-400 flex items-center gap-1">
                  {{ f.label }}
                  <span
                    v-if="fieldsDiffer(activePair.candidateA, activePair.candidateB, f.key)"
                    class="text-amber-600 dark:text-amber-400"
                    title="Различие"
                  >●</span>
                </div>
                <div
                  class="px-3 py-1.5 truncate"
                  :class="fieldsDiffer(activePair.candidateA, activePair.candidateB, f.key) ? 'text-amber-800 dark:text-amber-300 font-medium' : 'text-surface-700 dark:text-surface-300'"
                >
                  {{ (activePair.candidateA[f.key] as string) || '—' }}
                </div>
                <div
                  class="px-3 py-1.5 truncate"
                  :class="fieldsDiffer(activePair.candidateA, activePair.candidateB, f.key) ? 'text-amber-800 dark:text-amber-300 font-medium' : 'text-surface-700 dark:text-surface-300'"
                >
                  {{ (activePair.candidateB[f.key] as string) || '—' }}
                </div>
              </div>
            </div>

            <!-- Primary selector -->
            <div class="grid grid-cols-2 gap-3">
              <label
                v-for="cand in [activePair.candidateA, activePair.candidateB]"
                :key="cand.id"
                :class="[
                  'rounded-lg border-2 p-4 cursor-pointer transition-colors',
                  selectedPrimaryId === cand.id
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                    : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600',
                ]"
              >
                <input
                  v-model="selectedPrimaryId"
                  type="radio"
                  :value="cand.id"
                  class="sr-only"
                />
                <div class="flex items-center justify-between mb-1">
                  <span class="text-xs font-medium text-surface-500 dark:text-surface-400">
                    {{ selectedPrimaryId === cand.id ? 'Primary' : 'Будет слит' }}
                  </span>
                  <ShieldAlert v-if="cand.fraudFlag" class="size-4 text-danger-500" />
                </div>
                <div class="font-medium text-sm text-surface-900 dark:text-surface-50 truncate">
                  {{ formatName(cand) }}
                </div>
                <div v-if="cand.email" class="text-xs text-surface-500 dark:text-surface-400 truncate">
                  {{ cand.email }}
                </div>
                <NuxtLink
                  :to="`/dashboard/candidates/${cand.id}`"
                  target="_blank"
                  class="inline-block text-xs text-brand-600 dark:text-brand-400 hover:underline mt-2"
                >
                  Открыть карточку →
                </NuxtLink>
              </label>
            </div>

            <!-- Reason -->
            <div>
              <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                Причина (опционально)
              </label>
              <textarea
                v-model="mergeReason"
                rows="2"
                placeholder="Например: один и тот же кандидат, разные источники"
                class="w-full text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2"
              />
            </div>
          </div>

          <div class="px-6 py-3 border-t border-surface-200 dark:border-surface-800 flex justify-end gap-2">
            <button
              class="rounded-md px-4 py-2 text-sm font-medium border border-surface-300 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-200"
              :disabled="isMerging"
              @click="closeMerge"
            >
              Отмена
            </button>
            <button
              class="rounded-md px-4 py-2 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
              :disabled="isMerging || !selectedPrimaryId"
              @click="submitMerge"
            >
              {{ isMerging ? 'Сливаем…' : 'Подтвердить слияние' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
