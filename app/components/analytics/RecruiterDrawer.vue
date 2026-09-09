<script setup lang="ts">
/**
 * Центр аналитики: выезжающая панель активности рекрутёра (Блок A).
 * 3 секции: Интервью, Движения по кандидатам, Эффективность.
 */
import { X, Calendar, Activity, Zap } from 'lucide-vue-next'
import { baseCartesianOption, CHART_PALETTE } from '~/utils/analytics/chart-theme'

const props = defineProps<{ userId: string | null, name: string, query: Record<string, string> }>()
const emit = defineEmits<{ close: [] }>()

const { isDark } = useColorMode()

const { data, status } = useFetch(() => `/api/analytics/recruiters/${props.userId}/activity`, {
  key: computed(() => `recruiter-activity-${props.userId}`),
  headers: useRequestHeaders(['cookie']),
  query: computed(() => props.query),
  immediate: false,
  watch: [() => props.userId, () => props.query],
})

const isLoading = computed(() => status.value === 'pending' && !data.value)
const iv = computed<any>(() => (data.value as any)?.interviews ?? null)
const mv = computed<any>(() => (data.value as any)?.movements ?? null)
const eff = computed<any>(() => (data.value as any)?.efficiency ?? null)

// Drill-down по интервью
const drill = ref<{ url: string, query: Record<string, string>, title: string } | null>(null)
function openInterviews(statusFilter?: string) {
  drill.value = {
    url: `/api/analytics/recruiters/${props.userId}/interviews`,
    query: { ...props.query, ...(statusFilter ? { status: statusFilter } : {}) },
    title: `Интервью — ${props.name}`,
  }
}

const typeChartOption = computed(() => {
  if (!iv.value?.byType?.length) return {}
  const base = baseCartesianOption(isDark.value)
  const typeLabels: Record<string, string> = { phone: 'Телефон', video: 'Видео', in_person: 'Очно', panel: 'Панель', technical: 'Тех', take_home: 'Тест' }
  return {
    ...base,
    tooltip: { ...base.tooltip, trigger: 'item' },
    xAxis: { type: 'category', data: iv.value.byType.map((t: any) => typeLabels[t.type] ?? t.type), axisTick: { show: false } },
    yAxis: { type: 'value', minInterval: 1 },
    series: [{ type: 'bar', data: iv.value.byType.map((t: any) => t.count), itemStyle: { color: CHART_PALETTE[0], borderRadius: [3, 3, 0, 0] } }],
  }
})

function pct(v: number | null) { return v != null ? `${Math.round(v * 100)}%` : '—' }

function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="userId" class="fixed inset-0 z-50 flex justify-end">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')" />
      <div class="relative w-full max-w-2xl h-full bg-surface-50 dark:bg-surface-950 shadow-2xl overflow-y-auto">
        <div class="sticky top-0 z-10 bg-surface-50/95 dark:bg-surface-950/95 backdrop-blur border-b border-surface-200 dark:border-surface-800 px-6 py-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-50 truncate">{{ name }}</h2>
          <button class="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300" @click="emit('close')"><X class="w-5 h-5" /></button>
        </div>

        <div class="p-6 space-y-6">
          <div v-if="isLoading" class="space-y-4 animate-pulse">
            <div v-for="i in 3" :key="i" class="h-24 bg-surface-100 dark:bg-surface-800 rounded-xl" />
          </div>

          <template v-else-if="iv">
            <!-- Интервью -->
            <section class="rounded-xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
              <div class="flex items-center gap-2 mb-3"><Calendar class="w-4 h-4 text-primary-500" /><h3 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Интервью</h3></div>
              <div class="grid grid-cols-4 gap-3 mb-4">
                <button class="text-left rounded-lg bg-surface-50 dark:bg-surface-800 p-3 hover:ring-1 ring-primary-400" @click="openInterviews()">
                  <div class="text-xs text-surface-500">Запланировано</div>
                  <div class="text-lg font-semibold text-surface-900 dark:text-surface-50 tabular-nums">{{ iv.scheduled }}</div>
                </button>
                <button class="text-left rounded-lg bg-surface-50 dark:bg-surface-800 p-3 hover:ring-1 ring-primary-400" @click="openInterviews('completed')">
                  <div class="text-xs text-surface-500">Проведено</div>
                  <div class="text-lg font-semibold text-success-600 dark:text-success-400 tabular-nums">{{ iv.completed }}</div>
                </button>
                <button class="text-left rounded-lg bg-surface-50 dark:bg-surface-800 p-3 hover:ring-1 ring-primary-400" @click="openInterviews('no_show')">
                  <div class="text-xs text-surface-500">No-show</div>
                  <div class="text-lg font-semibold text-danger-600 dark:text-danger-400 tabular-nums">{{ iv.noShow }}</div>
                </button>
                <div class="rounded-lg bg-surface-50 dark:bg-surface-800 p-3">
                  <div class="text-xs text-surface-500">No-show rate</div>
                  <div class="text-lg font-semibold text-surface-900 dark:text-surface-50 tabular-nums">{{ pct(iv.noShowRate) }}</div>
                </div>
              </div>
              <ClientOnly>
                <AnalyticsAeChart v-if="iv.byType?.length" :option="typeChartOption" :height="160" />
                <template #fallback><div class="h-[160px] animate-pulse rounded-xl bg-surface-100 dark:bg-surface-800" /></template>
              </ClientOnly>
            </section>

            <!-- Движения -->
            <section class="rounded-xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
              <div class="flex items-center gap-2 mb-3"><Activity class="w-4 h-4 text-primary-500" /><h3 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Движения по кандидатам</h3></div>
              <div class="grid grid-cols-3 gap-3 text-sm">
                <div v-for="m in [
                  { l: 'Всего ходов', v: mv.totalMoves }, { l: 'На контакт', v: mv.toContact }, { l: 'На интервью', v: mv.toInterview },
                  { l: 'На оффер', v: mv.toOffer }, { l: 'Наймы', v: mv.hires }, { l: 'Отказы', v: mv.rejects },
                  { l: 'Комментарии', v: mv.commentsAdded }, { l: 'Сообщения', v: mv.messagesSent }, { l: 'Контакты открыто', v: mv.contactsOpened },
                ]" :key="m.l" class="rounded-lg bg-surface-50 dark:bg-surface-800 p-3">
                  <div class="text-xs text-surface-500">{{ m.l }}</div>
                  <div class="text-base font-semibold text-surface-900 dark:text-surface-50 tabular-nums">{{ m.v }}</div>
                </div>
              </div>
            </section>

            <!-- Эффективность -->
            <section class="rounded-xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
              <div class="flex items-center gap-2 mb-3"><Zap class="w-4 h-4 text-primary-500" /><h3 class="text-sm font-semibold text-surface-900 dark:text-surface-50">Эффективность</h3></div>
              <div class="grid grid-cols-3 gap-3 text-sm">
                <div class="rounded-lg bg-surface-50 dark:bg-surface-800 p-3">
                  <div class="text-xs text-surface-500">Первый ответ (медиана)</div>
                  <div class="text-base font-semibold text-surface-900 dark:text-surface-50 tabular-nums">{{ eff.firstResponseMedianHours != null ? `${eff.firstResponseMedianHours} ч` : '—' }}</div>
                </div>
                <div class="rounded-lg bg-surface-50 dark:bg-surface-800 p-3">
                  <div class="text-xs text-surface-500">Интервью→оффер</div>
                  <div class="text-base font-semibold text-surface-900 dark:text-surface-50 tabular-nums">{{ pct(eff.interviewToOfferRate) }}</div>
                </div>
                <div class="rounded-lg bg-surface-50 dark:bg-surface-800 p-3">
                  <div class="text-xs text-surface-500">Активных дней</div>
                  <div class="text-base font-semibold text-surface-900 dark:text-surface-50 tabular-nums">{{ eff.activeDays }}</div>
                </div>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>

    <AnalyticsDrillDownModal v-if="drill" :url="drill.url" :query="drill.query" :title="drill.title" @close="drill = null" />
  </Teleport>
</template>
