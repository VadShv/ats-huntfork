<script setup lang="ts">
import { MessageSquare, RefreshCw, Loader2, Unlink2 } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const jobId = route.params.id as string
const toast = useToast()

const { allowed: canRead } = usePermission({ hhNegotiation: ['read'] })
const { allowed: canSync } = usePermission({ hhNegotiation: ['sync'] })

useSeoMeta({ title: () => 'Переговоры hh.ru' })

interface HhLinkResponse {
  linked: boolean
  link?: {
    id: string
    hhVacancyId: string
    hhVacancyUrl: string | null
    hhVacancyTitle: string | null
    lastSyncAt: string | null
    lastSyncStatus: string | null
    lastSyncError: string | null
    importedCount: number
    autoSyncEnabled: boolean
    pushSyncEnabled: boolean
  } | null
}

const { data: linkData, status: linkStatus } = await useFetch<HhLinkResponse>(`/api/jobs/${jobId}/hh-link`, {
  key: `hh-link-${jobId}`,
  headers: useRequestHeaders(['cookie']),
})

const isLinked = computed(() => linkData.value?.linked === true)
const link = computed(() => isLinked.value ? linkData.value?.link ?? null : null)
const linkId = computed(() => link.value?.id ?? null)

interface NegotiationItem {
  id: string
  hhNegotiationId: string
  hhCollection: string | null
  hhState: string | null
  hhCreatedAt: string | null
  applicationId: string | null
  candidateName: string | null
  applicationStatus: string | null
}

interface NegotiationsResponse {
  items: NegotiationItem[]
  total: number
  page: number
  perPage: number
}

const negotiationsUrl = computed(() =>
  linkId.value ? '/api/hh/negotiations' : '',
)

const { data: negData, status: negStatus } = useFetch<NegotiationsResponse>(() => negotiationsUrl.value, {
  key: 'hh-negotiations',
  query: { vacancyLinkId: linkId },
  headers: useRequestHeaders(['cookie']),
  default: () => ({ items: [], total: 0, page: 0, perPage: 20 }),
})

const items = computed<NegotiationItem[]>(() => negData.value?.items ?? [])
const total = computed(() => negData.value?.total ?? 0)
const linkLoading = computed(() => linkStatus.value === 'pending')
const negLoading = computed(() => negStatus.value === 'pending')

// ── Sync ──
const isSyncing = ref(false)
async function onSync() {
  if (!linkId.value) return
  isSyncing.value = true
  try {
    await $fetch(`/api/hh/sync/${linkId.value}`, { method: 'POST' })
    await refreshNuxtData('hh-negotiations')
    toast.success('Синхронизация завершена')
  }
  catch (err: any) {
    toast.error('Ошибка синхронизации', {
      message: err?.data?.statusMessage ?? err?.message,
    })
  }
  finally {
    isSyncing.value = false
  }
}

function formatLastSync(dateStr: string | null): string {
  if (!dateStr) return 'никогда'
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'только что'
  if (diffMins < 60) return `${diffMins} мин назад`
  if (diffHours < 24) return `${diffHours} ч назад`
  return `${diffDays} дн назад`
}

// ── Thread modal ──
const threadOpen = ref(false)
const threadNegotiationId = ref<string | null>(null)
const threadCandidateName = ref<string | null>(null)

function openThread(item: NegotiationItem) {
  threadNegotiationId.value = item.id
  threadCandidateName.value = item.candidateName
  threadOpen.value = true
}

// ── Load more (simple pagination) ──
const currentPage = ref(0)
const extraItems = ref<NegotiationItem[]>([])
const hasMore = computed(() => items.value.length + extraItems.value.length < total.value)
const loadingMore = ref(false)

async function loadMore() {
  if (!linkId.value || loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    currentPage.value += 1
    const data = await $fetch<NegotiationsResponse>('/api/hh/negotiations', {
      query: { vacancyLinkId: linkId.value, page: currentPage.value },
    })
    extraItems.value.push(...data.items)
  }
  catch {
    currentPage.value -= 1
  }
  finally {
    loadingMore.value = false
  }
}

const allItems = computed(() => [...items.value, ...extraItems.value])

// Reset extra items when main data refreshes
watch(() => negData.value, () => {
  extraItems.value = []
  currentPage.value = 0
})
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6">
    <!-- Header -->
    <div class="mb-6 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="flex items-center gap-2 text-lg font-semibold text-surface-900 dark:text-surface-100">
          <MessageSquare class="size-5 text-brand-600" />
          Переговоры hh.ru
        </h1>
        <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
          Отклики и переписка с кандидатами
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <UiButton
          v-if="canSync && isLinked"
          variant="outline"
          size="sm"
          :icon-left="RefreshCw"
          :loading="isSyncing"
          :disabled="isSyncing"
          @click="onSync"
        >
          Синхронизировать
        </UiButton>
      </div>
    </div>

    <!-- Permission gate -->
    <AccessDeniedBanner v-if="!canRead" />

    <!-- Loading link -->
    <div v-else-if="linkLoading" class="flex items-center gap-2 py-12 text-surface-400">
      <Loader2 class="size-4 animate-spin" /> …
    </div>

    <!-- Not linked to hh.ru -->
    <EmptyState
      v-else-if="!isLinked"
      :icon="Unlink2"
      title="Вакансия не связана с hh.ru"
      description="Свяжите вакансию с hh.ru в настройках, чтобы видеть отклики и переписку."
    />

    <!-- Linked — show negotiations -->
    <template v-else>
      <!-- Last sync info -->
      <div class="mb-4 flex items-center justify-between text-xs text-surface-500 dark:text-surface-400">
        <span>
          Последняя синхронизация: {{ formatLastSync(link?.lastSyncAt ?? null) }}
        </span>
        <span v-if="total > 0">
          Всего откликов: {{ total }}
        </span>
      </div>

      <HhNegotiationList
        :items="allItems"
        :loading="negLoading"
        @open="openThread"
        @load-more="loadMore"
      />

      <div v-if="loadingMore" class="flex items-center justify-center gap-2 py-4 text-surface-400">
        <Loader2 class="size-4 animate-spin" />
      </div>
    </template>

    <!-- Thread modal -->
    <HhNegotiationThread
      v-if="threadNegotiationId"
      v-model="threadOpen"
      :negotiation-id="threadNegotiationId"
      :candidate-name="threadCandidateName"
    />
  </div>
</template>
