<script setup lang="ts">
import {
  ChartNoAxesCombined, AlertCircle, RefreshCw, Filter as FilterIcon,
  ChevronLeft, ChevronRight, X, UserX,
} from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Аналитика подбора — Воронка',
  description: 'Воронка найма по этапам: конверсии, время на этапе, отсеянные кандидаты',
})

const localePath = useLocalePath()
const { formatPersonName, formatDateTime } = useOrgSettings()

// ─────────────────────────────────────────────
// Фильтры
// ─────────────────────────────────────────────

import { useAnalyticsFilters } from '~/composables/useAnalyticsFilters'

const { periodPreset, jobId, source, query } = useAnalyticsFilters()
const pipelineId = ref<string | undefined>(undefined)

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

const { data: pipelinesData } = useFetch('/api/pipelines', {
  key: 'analytics-pipelines',
  headers: useRequestHeaders(['cookie']),
})
const pipelines = computed(() => (pipelinesData.value as any) ?? [])

const funnelQuery = computed(() => {
  const q = { ...query.value }
  delete q.compare
  if (pipelineId.value) q.pipelineId = pipelineId.value
  return q
})

// ─────────────────────────────────────────────
// Воронка
// ─────────────────────────────────────────────

const { data: funnel, status: funnelStatus, error: funnelError, refresh: refreshFunnel } = useFetch('/api/analytics/funnel', {
  key: 'analytics-funnel',
  headers: useRequestHeaders(['cookie']),
  query: funnelQuery,
})

const isLoading = computed(() => funnelStatus.value === 'pending' && !funnel.value)
const stages = computed(() => (funnel.value as any)?.stages ?? [])
const transitions = computed(() => (funnel.value as any)?.transitions ?? [])

const refreshedAtLabel = computed(() => {
  const iso = (funnel.value as any)?.refreshedAt
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
})

const maxEntered = computed(() =>
  Math.max(1, ...stages.value.map((s: any) => s.entered ?? 0)),
)

function barWidth(entered: number) {
  return `${Math.max(2, Math.round((entered / maxEntered.value) * 100))}%`
}

function fmtHours(hours: number | null) {
  if (hours == null) return '—'
  if (hours >= 48) return `${Math.round((hours / 24) * 10) / 10} дн`
  return `${Math.round(hours * 10) / 10} ч`
}

function fmtPct(v: number | null) {
  return v != null ? `${Math.round(v * 100)}%` : '—'
}

// ─────────────────────────────────────────────
// Drill-down отсеянных
// ─────────────────────────────────────────────

const dropoffStage = ref<{ id: string, name: string } | null>(null)
const dropoffPage = ref(1)

function openDropoff(stage: any) {
  if (dropoffStage.value?.id === stage.id) {
    dropoffStage.value = null
    return
  }
  dropoffPage.value = 1
  dropoffStage.value = { id: stage.id, name: stage.name }
}

const { data: dropoff, status: dropoffStatus, refresh: fetchDropoff } = useFetch('/api/analytics/funnel/dropoff', {
  key: 'analytics-dropoff',
  headers: useRequestHeaders(['cookie']),
  query: computed(() => ({
    ...funnelQuery.value,
    stageId: dropoffStage.value?.id ?? '',
    page: String(dropoffPage.value),
    limit: '25',
  })),
  immediate: false,
  watch: false,
})

watch([dropoffStage, dropoffPage, funnelQuery], () => {
  if (dropoffStage.value) fetchDropoff()
})

const dropoffItems = computed(() => (dropoff.value as any)?.items ?? [])
const dropoffTotal = computed(() => (dropoff.value as any)?.total ?? 0)
const dropoffPages = computed(() => Math.max(1, Math.ceil(dropoffTotal.value / 25)))
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
          class="px-3 py-1.5 rounded-lg text-sm font-medium text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200"
        >
          Обзор
        </NuxtLink>
        <NuxtLink
          :to="localePath('/dashboard/analytics/funnel')"
          class="px-3 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-50 shadow-xs"
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
          v-model="pipelineId"
          class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs text-surface-700 dark:text-surface-300 max-w-56"
        >
          <option :value="undefined">Воронка по умолчанию</option>
          <option v-for="p in pipelines" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
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
      </div>
    </div>

    <!-- Ошибка -->
    <div
      v-if="funnelError"
      class="rounded-2xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/60 p-5 text-sm text-danger-700 dark:text-danger-400 flex items-center gap-3"
    >
      <AlertCircle class="w-5 h-5 shrink-0" />
      Не удалось загрузить воронку. <button class="underline" @click="refreshFunnel()">Повторить</button>
    </div>

    <!-- Скелетон -->
    <div v-else-if="isLoading" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 space-y-4 animate-pulse">
      <div v-for="i in 5" :key="i" class="h-12 bg-surface-100 dark:bg-surface-800/60 rounded-lg" />
    </div>

    <!-- Пустое состояние -->
    <div
      v-else-if="!stages.length"
      class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-10 text-center text-sm text-surface-400 dark:text-surface-500"
    >
      Нет данных за выбранный период — измените фильтры или подождите первого обновления аналитики
    </div>

    <template v-else>
      <!-- Воронка -->
      <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
        <div class="px-5 py-4 border-b border-surface-100 dark:border-surface-800">
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Воронка по этапам</h2>
          <p class="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
            Клик по этапу — список отсеянных с него. Конверсия = ушли дальше / всего покинувших этап.
          </p>
        </div>
        <div class="p-5 space-y-3">
          <button
            v-for="stage in stages"
            :key="stage.id"
            class="w-full text-left group"
            @click="openDropoff(stage)"
          >
            <div class="flex items-center justify-between mb-1 gap-2">
              <span class="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
                {{ stage.name }}
                <span v-if="dropoffStage?.id === stage.id" class="text-primary-600 dark:text-primary-400 text-xs ml-1">— отсеянные ниже</span>
              </span>
              <span class="text-xs text-surface-400 dark:text-surface-500 tabular-nums shrink-0">
                сейчас: {{ stage.current }} · медиана: {{ fmtHours(stage.medianHours) }}
              </span>
            </div>
            <div class="relative h-9 rounded-lg bg-surface-100 dark:bg-surface-800 overflow-hidden">
              <div
                class="absolute inset-y-0 left-0 rounded-lg transition-all group-hover:opacity-90"
                :style="{ width: barWidth(stage.entered), backgroundColor: stage.color || '#3b82f6' }"
              />
              <div class="absolute inset-0 flex items-center justify-between px-3">
                <span class="text-xs font-semibold text-white mix-blend-difference tabular-nums">{{ stage.entered }} вошло</span>
                <span class="text-xs text-surface-500 dark:text-surface-400 tabular-nums">
                  дальше: {{ fmtPct(stage.conversionNext) }} · от входа: {{ fmtPct(stage.conversionFromStart) }}
                  <span v-if="stage.exitsRejected" class="text-danger-500">· отказ: {{ stage.exitsRejected }}</span>
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Drill-down отсеянных -->
      <div
        v-if="dropoffStage"
        class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none"
      >
        <div class="px-5 py-4 border-b border-surface-100 dark:border-surface-800 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UserX class="w-4 h-4 text-danger-500" />
            <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">
              Отсеянные с этапа «{{ dropoffStage.name }}»
              <span class="text-surface-400 font-normal">({{ dropoffTotal }})</span>
            </h2>
          </div>
          <button class="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300" @click="dropoffStage = null">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div v-if="dropoffStatus === 'pending'" class="p-5 space-y-3">
          <div v-for="i in 3" :key="i" class="h-10 bg-surface-100 dark:bg-surface-800/60 rounded-lg animate-pulse" />
        </div>

        <div v-else-if="!dropoffItems.length" class="p-8 text-center text-sm text-surface-400 dark:text-surface-500">
          За выбранный период с этого этапа никто не отсеян
        </div>

        <template v-else>
          <ul class="divide-y divide-surface-100 dark:divide-surface-800">
            <li v-for="item in dropoffItems" :key="`${item.applicationId}-${item.exitedAt}`">
              <NuxtLink
                :to="localePath(`/dashboard/applications/${item.applicationId}`)"
                class="flex items-center gap-3 px-5 py-3 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                    {{ formatPersonName(item.candidateFirstName, item.candidateLastName) }}
                  </p>
                  <p class="text-xs text-surface-500 dark:text-surface-400 truncate">{{ item.jobTitle }}</p>
                </div>
                <div class="text-right shrink-0">
                  <p class="text-xs font-medium text-danger-600 dark:text-danger-400">{{ item.rejectReason }}</p>
                  <p class="text-xs text-surface-400 dark:text-surface-500">
                    {{ item.movedByName ? `${item.movedByName} · ` : '' }}{{ formatDateTime(item.exitedAt) }}
                  </p>
                </div>
              </NuxtLink>
            </li>
          </ul>
          <div v-if="dropoffPages > 1" class="px-5 py-3 border-t border-surface-100 dark:border-surface-800 flex items-center justify-between">
            <button
              class="inline-flex items-center gap-1 text-xs font-medium text-surface-600 dark:text-surface-400 disabled:opacity-40"
              :disabled="dropoffPage <= 1"
              @click="dropoffPage--"
            >
              <ChevronLeft class="w-3.5 h-3.5" /> Назад
            </button>
            <span class="text-xs text-surface-400 tabular-nums">{{ dropoffPage }} / {{ dropoffPages }}</span>
            <button
              class="inline-flex items-center gap-1 text-xs font-medium text-surface-600 dark:text-surface-400 disabled:opacity-40"
              :disabled="dropoffPage >= dropoffPages"
              @click="dropoffPage++"
            >
              Вперёд <ChevronRight class="w-3.5 h-3.5" />
            </button>
          </div>
        </template>
      </div>

      <!-- Матрица переходов -->
      <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
        <div class="px-5 py-4 border-b border-surface-100 dark:border-surface-800">
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Переходы между этапами</h2>
          <p class="text-xs text-surface-400 dark:text-surface-500 mt-0.5">Все переходы за период, включая возвраты назад и отказы</p>
        </div>
        <div v-if="!transitions.length" class="p-8 text-center text-sm text-surface-400 dark:text-surface-500">
          Переходов за период не было
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-surface-100 dark:border-surface-800 text-xs text-surface-400 dark:text-surface-500">
                <th class="text-left font-medium px-5 py-2.5">Откуда</th>
                <th class="text-left font-medium px-5 py-2.5">Куда</th>
                <th class="text-right font-medium px-5 py-2.5">Переходов</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-50 dark:divide-surface-800/60">
              <tr v-for="tr in transitions" :key="`${tr.fromId}-${tr.toId}`">
                <td class="px-5 py-2.5 text-surface-700 dark:text-surface-300">{{ tr.fromName }}</td>
                <td class="px-5 py-2.5 text-surface-700 dark:text-surface-300">{{ tr.toName }}</td>
                <td class="px-5 py-2.5 text-right tabular-nums font-medium text-surface-900 dark:text-surface-100">{{ tr.count }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
