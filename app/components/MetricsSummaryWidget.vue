<script setup lang="ts">
import { BarChart3, Briefcase, CheckCircle2, FileSignature, Timer, CalendarClock } from 'lucide-vue-next'

interface MetricsResponse {
  period: 'all' | 'season'
  seasonName: string | null
  openVacancies: number
  closedVacancies: number
  offers: number
  avgCloseDays: number | null
  interviewsPerWeek: number | null
}

const period = ref<'all' | 'season'>('season')

const { data, pending } = useFetch<MetricsResponse>('/api/metrics/summary', {
  query: { period },
  headers: useRequestHeaders(['cookie']),
})

const d = computed(() => data.value)

function fmt(v: number | null | undefined, suffix = ''): string {
  if (v == null) return '—'
  return `${v}${suffix}`
}

const rows = computed(() => [
  { key: 'open', icon: Briefcase, label: 'Вакансий в работе', value: fmt(d.value?.openVacancies), hint: 'Открытые вакансии, где вы — основной рекрутер. Показатель «сейчас», не зависит от периода.' },
  { key: 'closed', icon: CheckCircle2, label: 'Закрыто вакансий', value: fmt(d.value?.closedVacancies), hint: 'Вакансии, закрытые вами за выбранный период.' },
  { key: 'offers', icon: FileSignature, label: 'Сделано офферов', value: fmt(d.value?.offers), hint: 'Кандидаты, переведённые вами на стадию оффера за период.' },
  { key: 'closeDays', icon: Timer, label: 'Средний срок закрытия', value: fmt(d.value?.avgCloseDays, ' дн.'), hint: 'Среднее время от создания до закрытия вакансии (в днях) за период.' },
  { key: 'interviews', icon: CalendarClock, label: 'Интервью в неделю', value: fmt(d.value?.interviewsPerWeek), hint: 'Среднее число интервью в неделю за период.' },
])
</script>

<template>
  <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
    <div class="flex items-center justify-between gap-3 px-5 py-4 border-b border-surface-100 dark:border-surface-800">
      <div class="flex items-center gap-2 min-w-0">
        <BarChart3 class="size-5 text-brand-500 shrink-0" />
        <span class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">Мои метрики</span>
      </div>
      <!-- Period filter -->
      <div class="inline-flex rounded-lg border border-surface-200 dark:border-surface-700 p-0.5 shrink-0">
        <button
          type="button"
          class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors"
          :class="period === 'all'
            ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
            : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200'"
          @click="period = 'all'"
        >
          Всё время
        </button>
        <button
          type="button"
          class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors"
          :class="period === 'season'
            ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
            : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200'"
          @click="period = 'season'"
        >
          Сезон
        </button>
      </div>
    </div>

    <div v-if="period === 'season' && d?.seasonName" class="px-5 pt-3 text-[11px] text-surface-400 dark:text-surface-500">
      Текущий сезон: {{ d.seasonName }}
    </div>

    <ul class="divide-y divide-surface-100 dark:divide-surface-800" :class="{ 'opacity-60': pending }">
      <li v-for="r in rows" :key="r.key" class="flex items-center gap-3 px-5 py-3">
        <component :is="r.icon" class="size-4 text-surface-400 dark:text-surface-500 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="text-sm text-surface-800 dark:text-surface-200">{{ r.label }}</div>
          <div class="text-[11px] leading-snug text-surface-400 dark:text-surface-500">{{ r.hint }}</div>
        </div>
        <div class="text-sm font-semibold text-surface-900 dark:text-surface-100 tabular-nums shrink-0">{{ r.value }}</div>
      </li>
    </ul>
  </div>
</template>
