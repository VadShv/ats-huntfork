<script setup lang="ts">
import { Shield, ChevronRight, TrendingUp } from 'lucide-vue-next'

interface RankResponse {
  season: { name: string; daysLeft: number }
  rp: number
  division: { key: string; name: string; icon: string; subrank: number; atCeiling: boolean; isLegend: boolean; min?: number; max?: number }
  nextDivision: { key: string; name: string; remainingRp: number } | null
  position: number | null
  total: number
  breakdown: { hires: number; offers: number; interviews: number; vacanciesClosed: number; quality: number; speed: number; avgResponseHours: number | null }
}

const { data } = useFetch<RankResponse>('/api/rank', {
  headers: useRequestHeaders(['cookie']),
})

const d = computed(() => data.value)
const div = computed(() => d.value?.division)

// progress within the current division band
const bandProgress = computed(() => {
  const x = d.value
  if (!x || x.division.isLegend) return 100
  const min = x.division.min ?? 0
  const max = x.division.max ?? 1
  const span = max - min
  if (span <= 0) return 100
  return Math.min(100, Math.max(0, Math.round(((x.rp - min) / span) * 100)))
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

    <!-- Division badge -->
    <div class="flex items-center gap-3 mb-3">
      <div class="flex items-center justify-center size-12 shrink-0 rounded-xl bg-gradient-to-br text-white text-xl" :class="divColors[div?.key || 'bronze']">
        {{ div?.icon }}
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-surface-900 dark:text-surface-100">
          {{ div?.name }}<span v-if="div && !div.isLegend"> {{ div.subrank }}</span>
        </p>
        <p class="text-xs text-surface-400">{{ d.rp }} RP</p>
      </div>
    </div>

    <!-- Band progress -->
    <template v-if="!div?.isLegend">
      <div class="h-2 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
        <div class="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all" :style="{ width: `${bandProgress}%` }" />
      </div>
      <p v-if="d.nextDivision" class="text-[11px] text-surface-400 mt-1">
        До {{ d.nextDivision.name }}: {{ d.nextDivision.remainingRp }} RP
      </p>
    </template>
    <p v-else class="text-xs text-amber-600 dark:text-amber-400 font-medium">👑 Топ-{{ d.total < 3 ? d.total : 3 }} организации</p>

    <!-- Multipliers -->
    <div class="mt-3 pt-3 border-t border-surface-100 dark:border-surface-800 flex items-center gap-3 text-[11px] text-surface-500 dark:text-surface-400">
      <span :class="d.breakdown.quality >= 1.1 ? 'text-success-600 dark:text-success-400' : d.breakdown.quality < 1 ? 'text-danger-500' : ''">
        Качество ×{{ d.breakdown.quality }}
      </span>
      <span :class="d.breakdown.speed >= 1.1 ? 'text-success-600 dark:text-success-400' : d.breakdown.speed < 1 ? 'text-danger-500' : ''">
        Скорость ×{{ d.breakdown.speed }}
      </span>
      <span v-if="d.breakdown.avgResponseHours != null" class="text-surface-400">
        · ответ {{ d.breakdown.avgResponseHours }}ч
      </span>
    </div>
  </div>
</template>
