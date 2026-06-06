<script setup lang="ts">
import { Users, AlertTriangle, ChevronRight, X, Check, ShieldAlert } from 'lucide-vue-next'

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
  organizationId: string
  fraudFlag: boolean
}
interface DupPair {
  id: string
  score: number
  signals: Record<string, number>
  status: string
  createdAt: string
  candidateA: DupCandidate
  candidateB: DupCandidate
}

// ── Фильтры ─────────────────────────────────────────────────────────────────
const status = ref<'pending' | 'dismissed' | 'merged'>('pending')
const minScore = ref<number | undefined>(undefined)
const includeOtherOrgs = ref(true)

const query = computed(() => ({
  status: status.value,
  limit: 100,
  offset: 0,
  ...(minScore.value !== undefined ? { minScore: minScore.value } : {}),
  includeOtherOrgs: includeOtherOrgs.value,
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
        class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4"
      >
        <div class="flex items-start gap-4">
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
              <ShieldAlert v-if="pair.candidateA.fraudFlag" class="size-4 text-danger-500" />
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
              <ShieldAlert v-if="pair.candidateB.fraudFlag" class="size-4 text-danger-500" />
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

        <!-- Signals -->
        <div class="mt-2 pl-16 text-xs text-surface-500 dark:text-surface-400">
          {{ signalsList(pair.signals) }}
        </div>
      </div>
    </div>

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
