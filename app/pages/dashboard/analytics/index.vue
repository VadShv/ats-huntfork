<script setup lang="ts">
import {
  ChartNoAxesCombined, Users, UserPlus, BadgeCheck, UserX,
  Timer, Handshake, AlertCircle, Clock, ArrowUpRight, ArrowDownRight,
  Minus, RefreshCw, Filter as FilterIcon,
} from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Аналитика подбора — Обзор',
  description: 'KPI подбора: активные отклики, наймы, отказы, Time-to-Hire, Offer Acceptance',
})

const localePath = useLocalePath()
const { formatPersonName } = useOrgSettings()

// ─────────────────────────────────────────────
// Фильтры (общие для страниц аналитики)
// ─────────────────────────────────────────────

import { useAnalyticsFilters } from '~/composables/useAnalyticsFilters'

const { periodPreset, jobId, source, compare, query } = useAnalyticsFilters()

const periodOptions = [
  { value: '7d' as const, label: '7 дней' },
  { value: '30d' as const, label: '30 дней' },
  { value: '90d' as const, label: '90 дней' },
]

const sourceOptions = [
  { value: '', label: 'Все источники' },
  { value: 'hh', label: 'hh.ru' },
  { value: 'manual', label: 'Вручную' },
]

const { data: jobsData } = useFetch('/api/jobs', {
  key: 'analytics-jobs',
  headers: useRequestHeaders(['cookie']),
  query: { limit: 100 },
})
const jobs = computed(() => (jobsData.value as any)?.data ?? [])

// ─────────────────────────────────────────────
// Данные
// ─────────────────────────────────────────────

const { data: overview, status: overviewStatus, error: overviewError, refresh: refreshOverview } = useFetch('/api/analytics/overview', {
  key: 'analytics-overview',
  headers: useRequestHeaders(['cookie']),
  query,
})

const { data: sla, status: slaStatus } = useFetch('/api/analytics/sla', {
  key: 'analytics-sla',
  headers: useRequestHeaders(['cookie']),
  query: computed(() => {
    const q: Record<string, string> = { limit: '10' }
    if (jobId.value) q.jobId = jobId.value
    if (source.value) q.source = source.value
    return q
  }),
})

const isLoading = computed(() => overviewStatus.value === 'pending' && !overview.value)

const refreshedAtLabel = computed(() => {
  const iso = (overview.value as any)?.refreshedAt ?? (sla.value as any)?.refreshedAt
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
})

// ─────────────────────────────────────────────
// KPI-карточки с дельтами
// ─────────────────────────────────────────────

/** invert=true — меньше значит лучше (отказы, Time-to-Hire) */
function delta(current: number | null | undefined, prev: number | null | undefined, invert = false) {
  if (current == null || prev == null) return null
  const diff = current - prev
  if (diff === 0) return { direction: 'flat' as const, text: 'без изменений', positive: null }
  const positive = invert ? diff < 0 : diff > 0
  const pct = prev !== 0 ? Math.round(Math.abs(diff / prev) * 100) : null
  return {
    direction: diff > 0 ? 'up' as const : 'down' as const,
    text: pct != null ? `${pct}%` : `${diff > 0 ? '+' : ''}${Math.round(diff * 10) / 10}`,
    positive,
  }
}

const kpiCards = computed(() => {
  const k = (overview.value as any)?.kpis
  const p = (overview.value as any)?.prevKpis
  if (!k) return []
  return [
    {
      key: 'active', label: 'Активные отклики', icon: Users,
      value: k.activeNow, sub: 'сейчас в работе', delta: null,
    },
    {
      key: 'new', label: 'Новые отклики', icon: UserPlus,
      value: k.newApplications, sub: 'за период', delta: delta(k.newApplications, p?.newApplications),
    },
    {
      key: 'hires', label: 'Наймы', icon: BadgeCheck,
      value: k.hires, sub: 'за период', delta: delta(k.hires, p?.hires),
    },
    {
      key: 'rejections', label: 'Отказы', icon: UserX,
      value: k.rejections, sub: 'за период', delta: delta(k.rejections, p?.rejections, true),
    },
    {
      key: 'tth', label: 'Time-to-Hire', icon: Timer,
      value: k.timeToHireP50Days != null ? `${k.timeToHireP50Days} дн` : '—',
      sub: k.timeToHireP90Days != null ? `p90: ${k.timeToHireP90Days} дн` : 'медиана по наймам',
      delta: delta(k.timeToHireP50Days, p?.timeToHireP50Days, true),
    },
    {
      key: 'offer', label: 'Offer Acceptance', icon: Handshake,
      value: k.offerAcceptance != null ? `${Math.round(k.offerAcceptance * 100)}%` : '—',
      sub: 'принятые офферы',
      delta: delta(k.offerAcceptance, p?.offerAcceptance),
    },
  ]
})

const slaItems = computed(() => (sla.value as any)?.items ?? [])

function fmtDays(days: number) {
  return `${Math.round(days * 10) / 10} дн`
}
</script>

<template>
  <div class="space-y-6">
    <!-- Заголовок + вкладки -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-950/60 flex items-center justify-center">
          <ChartNoAxesCombined class="w-5 h-5 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-50">Аналитика подбора</h1>
          <p v-if="refreshedAtLabel" class="text-xs text-surface-500 dark:text-surface-400 flex items-center gap-1">
            <RefreshCw class="w-3 h-3" /> данные на {{ refreshedAtLabel }}
          </p>
        </div>
      </div>
      <nav class="flex items-center gap-1 rounded-xl bg-surface-100 dark:bg-surface-800 p-1">
        <NuxtLink
          :to="localePath('/dashboard/analytics')"
          class="px-3 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-50 shadow-xs"
        >
          Обзор
        </NuxtLink>
        <NuxtLink
          :to="localePath('/dashboard/analytics/funnel')"
          class="px-3 py-1.5 rounded-lg text-sm font-medium text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200"
        >
          Воронка
        </NuxtLink>
      </nav>
    </div>

    <!-- Фильтры (sticky) -->
    <div class="sticky top-0 z-10 -mx-1 px-1 py-2 bg-surface-50/95 dark:bg-surface-950/95 backdrop-blur border-b border-surface-200/60 dark:border-surface-800/60">
      <div class="flex flex-wrap items-center gap-2">
        <FilterIcon class="w-4 h-4 text-surface-400 shrink-0" />
        <div class="flex rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
          <button
            v-for="opt in periodOptions"
            :key="opt.value"
            class="px-3 py-1.5 text-xs font-medium transition-colors"
            :class="periodPreset === opt.value
              ? 'bg-primary-600 text-white'
              : 'bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'"
            @click="periodPreset = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
        <select
          v-model="jobId"
          class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs text-surface-700 dark:text-surface-300 max-w-56"
        >
          <option :value="undefined">Все вакансии</option>
          <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }}</option>
        </select>
        <select
          v-model="source"
          class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs text-surface-700 dark:text-surface-300"
        >
          <option v-for="opt in sourceOptions" :key="opt.value" :value="opt.value || undefined">{{ opt.label }}</option>
        </select>
        <label class="flex items-center gap-1.5 text-xs text-surface-600 dark:text-surface-400 cursor-pointer select-none">
          <input v-model="compare" type="checkbox" class="rounded border-surface-300 dark:border-surface-600 text-primary-600 focus:ring-primary-500">
          Сравнить с пред. периодом
        </label>
      </div>
    </div>

    <!-- Ошибка -->
    <div
      v-if="overviewError"
      class="rounded-2xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/60 p-5 text-sm text-danger-700 dark:text-danger-400 flex items-center gap-3"
    >
      <AlertCircle class="w-5 h-5 shrink-0" />
      Не удалось загрузить аналитику. <button class="underline" @click="refreshOverview()">Повторить</button>
    </div>

    <!-- Скелетоны -->
    <div v-else-if="isLoading" class="grid grid-cols-2 md:grid-cols-3 gap-4">
      <div v-for="i in 6" :key="i" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 animate-pulse">
        <div class="h-3 w-24 bg-surface-200 dark:bg-surface-800 rounded mb-3" />
        <div class="h-7 w-16 bg-surface-200 dark:bg-surface-800 rounded mb-2" />
        <div class="h-3 w-20 bg-surface-100 dark:bg-surface-800/60 rounded" />
      </div>
    </div>

    <!-- KPI -->
    <div v-else class="grid grid-cols-2 md:grid-cols-3 gap-4">
      <div
        v-for="card in kpiCards"
        :key="card.key"
        class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 shadow-xs dark:shadow-none"
      >
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-medium text-surface-500 dark:text-surface-400">{{ card.label }}</span>
          <component :is="card.icon" class="w-4 h-4 text-surface-400 dark:text-surface-500" />
        </div>
        <div class="flex items-baseline gap-2">
          <span class="text-2xl font-semibold text-surface-900 dark:text-surface-50 tabular-nums">{{ card.value }}</span>
          <span
            v-if="card.delta"
            class="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums"
            :class="card.delta.positive === null
              ? 'text-surface-400'
              : card.delta.positive ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'"
          >
            <ArrowUpRight v-if="card.delta.direction === 'up'" class="w-3.5 h-3.5" />
            <ArrowDownRight v-else-if="card.delta.direction === 'down'" class="w-3.5 h-3.5" />
            <Minus v-else class="w-3.5 h-3.5" />
            {{ card.delta.text }}
          </span>
        </div>
        <p class="text-xs text-surface-400 dark:text-surface-500 mt-1">{{ card.sub }}</p>
      </div>
    </div>

    <!-- Замедления сейчас -->
    <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
      <div class="px-5 py-4 border-b border-surface-100 dark:border-surface-800 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Clock class="w-4 h-4 text-warning-500" />
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Замедления сейчас</h2>
        </div>
        <span class="text-xs text-surface-400">кандидаты на этапе дольше порога (SLA или p90 за 90 дней)</span>
      </div>

      <div v-if="slaStatus === 'pending' && !slaItems.length" class="p-5 space-y-3">
        <div v-for="i in 3" :key="i" class="h-10 bg-surface-100 dark:bg-surface-800/60 rounded-lg animate-pulse" />
      </div>

      <div v-else-if="!slaItems.length" class="p-8 text-center text-sm text-surface-400 dark:text-surface-500">
        Замедлений нет — все кандидаты в пределах пороговых сроков
      </div>

      <ul v-else class="divide-y divide-surface-100 dark:divide-surface-800">
        <li v-for="item in slaItems" :key="item.applicationId">
          <NuxtLink
            :to="localePath(`/dashboard/applications/${item.applicationId}`)"
            class="flex items-center gap-3 px-5 py-3 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
          >
            <span
              class="w-2 h-2 rounded-full shrink-0"
              :class="item.status === 'overdue' ? 'bg-danger-500' : 'bg-warning-500'"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                {{ formatPersonName(item.candidateFirstName, item.candidateLastName) }}
              </p>
              <p class="text-xs text-surface-500 dark:text-surface-400 truncate">{{ item.jobTitle }}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-sm font-medium text-surface-900 dark:text-surface-100 tabular-nums">
                {{ fmtDays(item.daysOnStage) }}
                <span class="text-surface-400 font-normal">на «{{ item.rootStageName }}»</span>
              </p>
              <p class="text-xs tabular-nums" :class="item.status === 'overdue' ? 'text-danger-600 dark:text-danger-400' : 'text-warning-600 dark:text-warning-400'">
                порог {{ item.thresholdDays != null ? fmtDays(item.thresholdDays) : '—' }}
                <span class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase"
                  :class="item.thresholdSource === 'sla'
                    ? 'bg-primary-50 dark:bg-primary-950/60 text-primary-600 dark:text-primary-400'
                    : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400'"
                >{{ item.thresholdSource === 'sla' ? 'SLA' : 'p90' }}</span>
              </p>
            </div>
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>
