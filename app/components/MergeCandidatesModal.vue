<script setup lang="ts">
import { Search, X, AlertTriangle, ShieldAlert, Loader2, ChevronRight } from 'lucide-vue-next'

/**
 * Модалка ручного слияния: текущий кандидат остаётся как primary,
 * пользователь ищет второго кандидата и сливает его в primary.
 *
 * Бэкенд: POST /api/candidates/:id/merge
 *   body: { mergedCandidateId, reason? }
 */

interface PrimaryCandidate {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  fraudFlag?: boolean
}

const props = defineProps<{
  primaryCandidate: PrimaryCandidate
}>()

const emit = defineEmits<{
  close: []
  merged: [{ primaryCandidateId: string; mergedCandidateId: string }]
}>()

const toast = useToast()

// ── Поиск ───────────────────────────────────────────────────────────────────
interface SearchItem {
  id: string
  firstName: string | null
  lastName: string | null
  displayName: string | null
  email: string | null
  phone: string | null
}

const searchInput = ref('')
const debouncedSearch = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = val.trim()
  }, 300)
})

const searchResults = ref<SearchItem[]>([])
const isSearching = ref(false)

watch(debouncedSearch, async (q) => {
  if (q.length < 2) {
    searchResults.value = []
    return
  }
  isSearching.value = true
  try {
    const res = await $fetch<{ data: SearchItem[] }>('/api/candidates', {
      query: { search: q, limit: 15, page: 1 },
    })
    // Исключаем самого primary
    searchResults.value = (res.data || []).filter(c => c.id !== props.primaryCandidate.id)
  }
  catch (err: any) {
    toast.error('Поиск не удался', { message: err.data?.statusMessage })
    searchResults.value = []
  }
  finally {
    isSearching.value = false
  }
})

// ── Выбор и предпросмотр ────────────────────────────────────────────────────
const selectedId = ref<string | null>(null)
interface FullCandidate {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  mergeStatus: string
  fraudFlag?: boolean
  fraudReason?: string | null
  applicationCount?: number
}
const selectedCandidate = ref<FullCandidate | null>(null)
const isLoadingPreview = ref(false)

async function selectCandidate(item: SearchItem) {
  selectedId.value = item.id
  selectedCandidate.value = null
  isLoadingPreview.value = true
  try {
    const res = await $fetch<FullCandidate>(`/api/candidates/${item.id}`)
    selectedCandidate.value = res
  }
  catch (err: any) {
    toast.error('Не удалось загрузить кандидата', { message: err.data?.statusMessage })
    selectedId.value = null
  }
  finally {
    isLoadingPreview.value = false
  }
}

function clearSelection() {
  selectedId.value = null
  selectedCandidate.value = null
}

// ── Слияние ─────────────────────────────────────────────────────────────────
const reason = ref('')
const isMerging = ref(false)

const canMerge = computed(() => {
  if (!selectedCandidate.value) return false
  if (selectedCandidate.value.mergeStatus === 'merged') return false
  return true
})

const mergeWarning = computed(() => {
  if (!selectedCandidate.value) return null
  if (selectedCandidate.value.mergeStatus === 'merged') {
    return 'Этот кандидат уже был слит ранее — выберите другого.'
  }
  return null
})

async function submit() {
  if (!selectedCandidate.value || !canMerge.value || isMerging.value) return
  isMerging.value = true
  try {
    const res = await $fetch<{
      ok: true
      primaryCandidateId: string
      mergedCandidateId: string
      transferred: { applications: number; applicationsDeletedAsDuplicates: number; documents: number; identities: number; resumeVersions: number }
    }>(`/api/candidates/${props.primaryCandidate.id}/merge`, {
      method: 'POST',
      body: {
        mergedCandidateId: selectedCandidate.value.id,
        reason: reason.value.trim() || undefined,
      },
    })
    toast.success?.(
      `Слито — заявок ${res.transferred.applications}, документов ${res.transferred.documents}, идентификаторов ${res.transferred.identities}`,
    )
    emit('merged', { primaryCandidateId: res.primaryCandidateId, mergedCandidateId: res.mergedCandidateId })
  }
  catch (err: any) {
    toast.error('Не удалось слить', { message: err.data?.statusMessage || err.message })
  }
  finally {
    isMerging.value = false
  }
}

function formatName(c: { firstName: string | null; lastName: string | null; displayName?: string | null; email?: string | null; id: string }) {
  if (c.displayName) return c.displayName
  const name = [c.lastName, c.firstName].filter(Boolean).join(' ').trim()
  return name || c.email || c.id.slice(0, 8)
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="emit('close')"
    >
      <div class="w-full max-w-3xl rounded-xl bg-white dark:bg-surface-900 shadow-2xl border border-surface-200 dark:border-surface-800 flex flex-col max-h-[90vh]">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-surface-200 dark:border-surface-800 flex items-center justify-between shrink-0">
          <div>
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-50">
              Слить кандидата в этого
            </h2>
            <p class="text-xs text-surface-500 dark:text-surface-400 mt-1">
              Выберите кандидата, которого нужно слить в <span class="font-medium text-surface-700 dark:text-surface-200">{{ formatName(primaryCandidate) }}</span>. Его заявки, документы и идентификаторы перейдут сюда.
            </p>
          </div>
          <button
            class="rounded-md p-1 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200"
            @click="emit('close')"
          >
            <X class="size-5" />
          </button>
        </div>

        <!-- Body -->
        <div class="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          <!-- Warning -->
          <div class="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900">
            <AlertTriangle class="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div class="text-xs text-amber-800 dark:text-amber-300">
              Слияние можно откатить в течение 30 дней через журнал. После — данные сольются окончательно.
            </div>
          </div>

          <!-- Search -->
          <div v-if="!selectedId">
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
              Поиск кандидата для слияния
            </label>
            <div class="relative">
              <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-surface-400" />
              <input
                v-model="searchInput"
                type="text"
                placeholder="ФИО или email (минимум 2 символа)"
                class="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900"
                autofocus
              />
              <Loader2 v-if="isSearching" class="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-surface-400 animate-spin" />
            </div>

            <!-- Results -->
            <div class="mt-2 max-h-72 overflow-y-auto">
              <div
                v-if="debouncedSearch.length >= 2 && !isSearching && searchResults.length === 0"
                class="text-xs text-surface-500 dark:text-surface-400 py-6 text-center"
              >
                Ничего не найдено
              </div>
              <div
                v-for="item in searchResults"
                :key="item.id"
                class="rounded-md px-3 py-2 hover:bg-surface-50 dark:hover:bg-surface-800 cursor-pointer border border-transparent hover:border-surface-200 dark:hover:border-surface-700 flex items-center justify-between"
                @click="selectCandidate(item)"
              >
                <div class="min-w-0">
                  <div class="text-sm font-medium text-surface-900 dark:text-surface-50 truncate">
                    {{ formatName(item) }}
                  </div>
                  <div class="text-xs text-surface-500 dark:text-surface-400 truncate">
                    {{ item.email || '—' }}
                    <span v-if="item.phone" class="ml-2">{{ item.phone }}</span>
                  </div>
                </div>
                <ChevronRight class="size-4 text-surface-400 shrink-0" />
              </div>
            </div>
          </div>

          <!-- Preview & confirm -->
          <div v-else>
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-medium text-surface-600 dark:text-surface-400">Будет слит в текущего</span>
              <button
                class="text-xs text-brand-600 dark:text-brand-400 hover:underline"
                @click="clearSelection"
              >
                Выбрать другого
              </button>
            </div>

            <div v-if="isLoadingPreview" class="rounded-lg border border-surface-200 dark:border-surface-700 p-4 text-center text-sm text-surface-500">
              <Loader2 class="size-5 mx-auto animate-spin" />
            </div>

            <div
              v-else-if="selectedCandidate"
              class="rounded-lg border-2 border-brand-500 bg-brand-50 dark:bg-brand-950/30 p-4"
            >
              <div class="flex items-start justify-between mb-1">
                <div class="font-medium text-sm text-surface-900 dark:text-surface-50">
                  {{ formatName(selectedCandidate) }}
                </div>
                <ShieldAlert v-if="selectedCandidate.fraudFlag" class="size-4 text-danger-500" />
              </div>
              <div class="text-xs text-surface-600 dark:text-surface-300 space-y-0.5">
                <div v-if="selectedCandidate.email">📧 {{ selectedCandidate.email }}</div>
                <div v-if="selectedCandidate.phone">📞 {{ selectedCandidate.phone }}</div>
                <div v-if="selectedCandidate.applicationCount !== undefined">
                  Заявок: {{ selectedCandidate.applicationCount }}
                </div>
              </div>
              <NuxtLink
                :to="`/dashboard/candidates/${selectedCandidate.id}`"
                target="_blank"
                class="inline-block text-xs text-brand-600 dark:text-brand-400 hover:underline mt-2"
              >
                Открыть карточку в новой вкладке →
              </NuxtLink>
            </div>

            <div v-if="mergeWarning" class="mt-3 flex items-start gap-2 p-3 rounded-lg bg-danger-50 dark:bg-danger-950/40 border border-danger-200 dark:border-danger-900">
              <AlertTriangle class="size-4 text-danger-600 dark:text-danger-400 shrink-0 mt-0.5" />
              <div class="text-xs text-danger-800 dark:text-danger-300">
                {{ mergeWarning }}
              </div>
            </div>

            <!-- Reason -->
            <div class="mt-3">
              <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                Причина (опционально)
              </label>
              <textarea
                v-model="reason"
                rows="2"
                placeholder="Например: один и тот же кандидат, разные источники"
                class="w-full text-sm rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2"
              />
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-6 py-3 border-t border-surface-200 dark:border-surface-800 flex justify-end gap-2 shrink-0">
          <button
            class="rounded-md px-4 py-2 text-sm font-medium border border-surface-300 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-200"
            :disabled="isMerging"
            @click="emit('close')"
          >
            Отмена
          </button>
          <button
            class="rounded-md px-4 py-2 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!canMerge || isMerging"
            @click="submit"
          >
            {{ isMerging ? 'Сливаем…' : 'Подтвердить слияние' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
