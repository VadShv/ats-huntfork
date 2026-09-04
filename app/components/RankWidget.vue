<script setup lang="ts">
import { Shield } from 'lucide-vue-next'

interface RankResponse {
  season: { name: string; daysLeft: number }
  rp: number
  division: { key: string; name: string; icon: string; subrank: number; isLegend: boolean; min: number; max: number }
  placement: { weeksLeft: number } | null
  promo: { progress: number; required: number; toDivision: string } | null
  nextDivision: { key: string; name: string; remainingRp: number } | null
  position: number | null
  total: number
  breakdown: { quality: number; speed: number; avgResponseHours: number | null }
  trend: number[]
}

const { data } = useFetch<RankResponse>('/api/rank', {
  headers: useRequestHeaders(['cookie']),
})
const d = computed(() => data.value)
const div = computed(() => d.value?.division)

const bandProgress = computed(() => {
  const x = d.value
  if (!x || x.division.isLegend) return 100
  const span = x.division.max - x.division.min
  if (span <= 0) return 100
  return Math.min(100, Math.max(0, Math.round(((x.rp - x.division.min) / span) * 100)))
})

// Simple sparkline points for the trend
const spark = computed(() => {
  const t = d.value?.trend ?? []
  if (t.length < 2) return ''
  const max = Math.max(...t, 1)
  const w = 100, h = 24
  return t.map((v, i) => `${(i / (t.length - 1)) * w},${h - (v / max) * h}`).join(' ')
})

const divColors: Record<string, string> = {
  bronze: 'from-amber-600 to-amber-800',
  silver: 'from-slate-400 to-slate-600',
  gold: 'from-yellow-400 to-yellow-600',
  platinum: 'from-cyan-300 to-teal-500',
  diamond: 'from-cyan-300 to-violet-400',
  legend: 'from-yellow-400 via-amber-500 to-orange-500',
}
</script>

<template>
  <div v-if="d" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <Shield class="size-5 text-brand-500" />
        <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">Ранг</span>
      </div>
      <span v-if="d.position" class="text-xs text-surface-400">#{{ d.position }} из {{ d.total }}</span>
    </div>

    <div class="flex items-center gap-3 mb-3">
      <div class="flex items-center justify-center size-12 shrink-0 rounded-xl bg-gradient-to-br text-white text-xl" :class="divColors[div?.key || 'bronze']">
        {{ div?.icon }}
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-surface-900 dark:text-surface-100">
          {{ div?.name }}<span v-if="div && !div.isLegend"> {{ div.subrank }}</span>
          <span v-if="d.placement" class="ml-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-surface-100 dark:bg-surface-800 text-surface-500">калибровка</span>
        </p>
        <p class="text-xs text-surface-400">{{ d.rp }} RP</p>
      </div>
    </div>

    <!-- Placement -->
    <p v-if="d.placement" class="text-[11px] text-surface-500 dark:text-surface-400">
      Калибровка: осталось {{ d.placement.weeksLeft }} нед. до размещения в дивизион
    </p>

    <!-- Legend -->
    <p v-else-if="div?.isLegend" class="text-xs text-amber-600 dark:text-amber-400 font-medium">👑 Топ организации</p>

    <!-- Band progress + promo -->
    <template v-else>
      <div class="h-2 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
        <div class="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all" :style="{ width: `${bandProgress}%` }" />
      </div>
      <div class="flex items-center justify-between mt-1">
        <p v-if="d.nextDivision" class="text-[11px] text-surface-400">До {{ d.nextDivision.name }}: {{ d.nextDivision.remainingRp }} RP</p>
        <p v-if="d.promo" class="text-[11px] font-medium text-brand-600 dark:text-brand-400">
          Промо {{ d.promo.progress }}/{{ d.promo.required }} → {{ d.promo.toDivision }}
        </p>
      </div>
    </template>

    <!-- Multipliers + trend -->
    <div class="mt-3 pt-3 border-t border-surface-100 dark:border-surface-800 flex items-center justify-between gap-2">
      <div class="flex items-center gap-3 text-[11px] text-surface-500 dark:text-surface-400">
        <span :class="d.breakdown.quality >= 1.1 ? 'text-success-600 dark:text-success-400' : d.breakdown.quality < 1 ? 'text-danger-500' : ''">Кач.×{{ d.breakdown.quality }}</span>
        <span :class="d.breakdown.speed >= 1.1 ? 'text-success-600 dark:text-success-400' : d.breakdown.speed < 1 ? 'text-danger-500' : ''">Скор.×{{ d.breakdown.speed }}</span>
      </div>
      <svg v-if="spark" viewBox="0 0 100 24" class="w-16 h-6 shrink-0" preserveAspectRatio="none">
        <polyline :points="spark" fill="none" stroke="currentColor" stroke-width="2" class="text-brand-500" />
      </svg>
    </div>
  </div>
</template>
