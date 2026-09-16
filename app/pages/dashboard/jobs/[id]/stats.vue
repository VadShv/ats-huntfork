<script setup lang="ts">
import { BarChart3, RefreshCw, Loader2 } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const { t } = useI18n()
const route = useRoute()
const jobId = route.params.id as string
const toast = useToast()

const { allowed: canRead } = usePermission({ hhStats: ['read'] })
const { allowed: canRefresh } = usePermission({ hhStats: ['refresh'] })

useSeoMeta({ title: () => t('dashboard.jobs.stats.title') })

const { data: linkData, status: linkStatus } = await useFetch<{
  linked: boolean
  link?: { id: string }
}>(`/api/jobs/${jobId}/hh-link`, {
  key: `hh-link-${jobId}`,
  headers: useRequestHeaders(['cookie']),
})

const link = linkData.value
const isLinked = link?.linked === true
const linkId = isLinked && link?.link ? link.link.id : null

const statsUrl = linkId ? `/api/hh/stats/vacancy/${linkId}` : ''
const { data: stats, status: statsStatus } = useFetch(() => statsUrl, {
  key: 'hh-stats',
  headers: useRequestHeaders(['cookie']),
})

const current = computed(() => stats.value?.current ?? null)
const trend = computed(() => stats.value?.trend ?? null)

const lastSnapshot = computed(() => {
  const tr = stats.value?.trend ?? []
  if (tr.length === 0) return null
  return tr.reduce((a, b) => (a.snapshotDate > b.snapshotDate ? a : b)).snapshotDate
})
const isStale = computed(() => {
  if (!lastSnapshot.value) return false
  return Date.now() - new Date(lastSnapshot.value).getTime() > 24 * 60 * 60 * 1000
})

function formatLastUpdate(dateStr: string) {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 60) return `${diffMins} мин назад`
  if (diffHours < 24) return `${diffHours} ч назад`
  return `${diffDays} дн назад`
}

const isRefreshing = ref(false)
async function onRefresh() {
  isRefreshing.value = true
  try {
    await $fetch('/api/hh/stats/refresh', { method: 'POST' })
    await refreshNuxtData('hh-stats')
    toast.success(t('dashboard.jobs.stats.refreshed'))
  }
  catch {
    toast.error(t('dashboard.jobs.stats.refreshError'))
  }
  finally {
    isRefreshing.value = false
  }
}

const linkLoading = computed(() => linkStatus.value === 'pending')
const statsLoading = computed(() => statsStatus.value === 'pending')
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6">
    <!-- Header -->
    <div class="mb-6 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="flex items-center gap-2 text-lg font-semibold text-surface-900 dark:text-surface-100">
          <BarChart3 class="size-5 text-brand-600" />
          {{ t('dashboard.jobs.stats.title') }}
        </h1>
        <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
          {{ t('dashboard.jobs.stats.subtitle') }}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <UiBadge v-if="isStale" variant="soft" tone="warning" size="sm">
          {{ t('dashboard.jobs.stats.staleBadge') }}
        </UiBadge>
        <UiButton
          v-if="canRefresh && isLinked"
          variant="outline"
          size="sm"
          :icon-left="RefreshCw"
          :loading="isRefreshing"
          :disabled="isRefreshing"
          @click="onRefresh"
        >
          {{ isRefreshing ? t('dashboard.jobs.stats.refreshing') : t('dashboard.jobs.stats.refresh') }}
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
      :icon="BarChart3"
      :title="t('dashboard.jobs.stats.notLinkedTitle')"
      :description="t('dashboard.jobs.stats.notLinkedDesc')"
    />

    <!-- Loading stats -->
    <div v-else-if="statsLoading" class="flex items-center gap-2 py-12 text-surface-400">
      <Loader2 class="size-4 animate-spin" /> …
    </div>

    <!-- Stats panel -->
    <template v-else-if="linkId">
      <HhVacancyStats :current="current" :trend="trend" />

      <p v-if="lastSnapshot" class="mt-6 text-xs text-surface-400 dark:text-surface-500">
        {{ t('dashboard.jobs.stats.lastUpdate') }}: {{ formatLastUpdate(lastSnapshot) }}
      </p>
    </template>
  </div>
</template>
