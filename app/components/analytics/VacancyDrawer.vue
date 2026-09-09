<script setup lang="ts">
/**
 * Центр аналитики: выезжающая панель с воронкой и метриками одной вакансии.
 * Открывается по клику на строку в разделе Vacancies.
 */
import { X, Timer, Users, BadgeCheck, UserX, RefreshCw } from 'lucide-vue-next'
import { baseCartesianOption, CHART_PALETTE, CHART_SEMANTIC } from '~/utils/analytics/chart-theme'

const props = defineProps<{ jobId: string | null, query?: Record<string, string> }>()
const emit = defineEmits<{ close: [] }>()

const localePath = useLocalePath()
const { isDark } = useColorMode()

const { data, status } = useFetch(() => `/api/analytics/jobs/${props.jobId}`, {
  key: computed(() => `analytics-vacancy-${props.jobId}`),
  headers: useRequestHeaders(['cookie']),
  query: computed(() => props.query ?? {}),
  immediate: false,
  watch: [() => props.jobId, () => props.query],
})

// Загружаем только когда появляется jobId (useFetch watch перезагрузит при смене jobId/query)
watch(() => props.jobId, (id) => { if (id) refreshNuxtData(`analytics-vacancy-${id}`) })

const job = computed(() => (data.value as any)?.job ?? null)
const stages = computed<any[]>(() => (data.value as any)?.stages ?? [])
const transitions = computed<any[]>(() => (data.value as any)?.transitions ?? [])
const isLoading = computed(() => status.value === 'pending' && !data.value)

const maxReached = computed(() => Math.max(1, ...stages.value.map(s => s.reached ?? 0)))
function barWidth(e: number) { return `${Math.max(2, Math.round((e / maxReached.value) * 100))}%` }
function fmtHours(h: number | null) {
  if (h == null) return '—'
  if (h >= 48) return `${Math.round((h / 24) * 10) / 10} дн`
  return `${Math.round(h * 10) / 10} ч`
}
function fmtPct(v: number | null) { return v != null ? `${Math.round(v * 100)}%` : '—' }

const kpis = computed(() => {
  const j = job.value
  if (!j) return []
  return [
    { label: 'Дней открыта', value: j.daysOpen != null ? `${j.daysOpen}` : '—', icon: Timer },
    { label: 'Срок закрытия', value: j.timeToFill != null ? `${j.timeToFill} дн` : '—', icon: Timer },
    { label: 'Активные', value: j.activeCandidates, icon: Users },
  ]
})

// Sankey переходов
const sankeyOption = computed(() => {
  if (!transitions.value.length) return {}
  const nodeSet = new Set<string>()
  for (const t of transitions.value) { nodeSet.add(t.fromName); nodeSet.add(t.toName) }
  const nodes = [...nodeSet].map((name, i) => ({ name, itemStyle: { color: CHART_PALETTE[i % CHART_PALETTE.length] } }))
  const links = transitions.value.filter(t => t.fromName !== t.toName).map(t => ({ source: t.fromName, target: t.toName, value: t.count }))
  const c = isDark.value ? { text: '#e4e4e7', bg: '#18181b', border: '#3f3f46' } : { text: '#3f3f46', bg: '#fff', border: '#e4e4e7' }
  return {
    tooltip: { trigger: 'item', backgroundColor: c.bg, borderColor: c.border, textStyle: { color: c.text, fontSize: 12 } },
    series: [{ type: 'sankey', data: nodes, links, emphasis: { focus: 'adjacency' }, nodeAlign: 'left', nodeGap: 8, nodeWidth: 14, label: { color: c.text, fontSize: 10 }, lineStyle: { curveness: 0.5, opacity: 0.4 } }],
  }
})

function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

const statusLabels: Record<string, string> = { draft: 'Черновик', open: 'Открыта', closed: 'Закрыта', archived: 'Архив' }
</script>

<template>
  <Teleport to="body">
    <div v-if="jobId" class="fixed inset-0 z-50 flex justify-end">
      <!-- Overlay -->
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')" />
      <!-- Drawer -->
      <div class="relative w-full max-w-2xl h-full bg-surface-50 dark:bg-surface-950 shadow-2xl overflow-y-auto">
        <!-- Header -->
        <div class="sticky top-0 z-10 bg-surface-50/95 dark:bg-surface-950/95 backdrop-blur border-b border-surface-200 dark:border-surface-800 px-6 py-4 flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-50 truncate">{{ job?.title ?? 'Загрузка…' }}</h2>
            <p v-if="job" class="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
              {{ statusLabels[job.status] ?? job.status }}
              <span v-if="job.departmentName"> · {{ job.departmentName }}</span>
              <span v-if="job.reopenCount > 0" class="text-warning-500"> · reopen: {{ job.reopenCount }}</span>
            </p>
          </div>
          <button class="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 shrink-0" @click="emit('close')">
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="p-6 space-y-6">
          <!-- Скелетон -->
          <div v-if="isLoading" class="space-y-4 animate-pulse">
            <div class="grid grid-cols-3 gap-3">
              <div v-for="i in 3" :key="i" class="h-20 bg-surface-100 dark:bg-surface-800 rounded-xl" />
            </div>
            <div class="h-40 bg-surface-100 dark:bg-surface-800 rounded-xl" />
          </div>

          <template v-else-if="job">
            <!-- KPI -->
            <div class="grid grid-cols-3 gap-3">
              <div v-for="k in kpis" :key="k.label" class="rounded-xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-4">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-xs text-surface-500 dark:text-surface-400">{{ k.label }}</span>
                  <component :is="k.icon" class="w-3.5 h-3.5 text-surface-400" />
                </div>
                <span class="text-xl font-semibold text-surface-900 dark:text-surface-50 tabular-nums">{{ k.value }}</span>
              </div>
            </div>

            <!-- Воронка -->
            <div v-if="stages.length" class="rounded-xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
              <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-50 mb-3">Воронка по этапам</h3>
              <div class="space-y-3">
                <div v-for="s in stages" :key="s.id">
                  <div class="flex items-center justify-between mb-1 gap-2">
                    <span class="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{{ s.name }}</span>
                    <span class="text-xs text-surface-400 tabular-nums shrink-0">сейчас: {{ s.current }} · медиана: {{ fmtHours(s.medianHours) }}</span>
                  </div>
                  <div class="relative h-8 rounded-lg bg-surface-100 dark:bg-surface-800 overflow-hidden">
                    <div class="absolute inset-y-0 left-0 rounded-lg" :style="{ width: barWidth(s.reached), backgroundColor: s.color || '#3b82f6' }" />
                    <div class="absolute inset-0 flex items-center justify-between px-3">
                      <span class="text-xs font-semibold text-white mix-blend-difference tabular-nums">{{ s.reached }} дошло</span>
                      <span class="text-xs text-surface-500 dark:text-surface-400 tabular-nums">дальше: {{ fmtPct(s.conversionNext) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Sankey -->
            <div v-if="transitions.length" class="rounded-xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
              <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-50 mb-3">Поток переходов</h3>
              <ClientOnly>
                <AnalyticsAeChart :option="sankeyOption" :height="280" />
                <template #fallback><div class="h-[280px] animate-pulse rounded-xl bg-surface-100 dark:bg-surface-800" /></template>
              </ClientOnly>
            </div>

            <NuxtLink :to="localePath(`/dashboard/jobs/${job.id}`)" class="block text-center text-sm text-primary-600 dark:text-primary-400 hover:underline">
              Открыть вакансию →
            </NuxtLink>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
