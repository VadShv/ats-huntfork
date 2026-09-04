<script setup lang="ts">
import { Ticket, ChevronRight, Gift } from 'lucide-vue-next'

interface TierReward { type: string; label: string; icon: string; amount?: number }
interface Tier { tier: number; requiredSxp: number; free: TierReward; premium: TierReward | null; reached: boolean; claimed: boolean }
interface HuntPassResponse {
  season: { name: string; quarter: number; year: number; daysLeft: number }
  sxp: number
  currentTier: number
  tierCount: number
  isPremium: boolean
  nextTier: { tier: number; requiredSxp: number; remaining: number } | null
  tiers: Tier[]
}

const { data } = useFetch<HuntPassResponse>('/api/huntpass', {
  headers: useRequestHeaders(['cookie']),
})

const season = computed(() => data.value?.season)
const currentTier = computed(() => data.value?.currentTier ?? 0)
const sxp = computed(() => data.value?.sxp ?? 0)
const nextTier = computed(() => data.value?.nextTier)

// Progress toward next tier (within current tier band)
const tierProgress = computed(() => {
  const d = data.value
  if (!d) return 0
  const cur = d.tiers.find(t => t.tier === d.currentTier)
  const nxt = d.nextTier
  if (!nxt) return 100
  const base = cur?.requiredSxp ?? 0
  const span = nxt.requiredSxp - base
  if (span <= 0) return 100
  return Math.min(100, Math.round(((d.sxp - base) / span) * 100))
})

const claimable = computed(() =>
  (data.value?.tiers ?? []).filter(t => t.reached && !t.claimed).length,
)
</script>

<template>
  <div v-if="data" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-gradient-to-br from-brand-50/60 to-white dark:from-brand-950/30 dark:to-surface-900 p-5">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <Ticket class="size-5 text-brand-500" />
        <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">HuntPass</span>
        <span v-if="data.isPremium" class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 text-white">PREMIUM</span>
      </div>
      <NuxtLink to="/dashboard/huntpass" class="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-0.5">
        Открыть <ChevronRight class="size-3" />
      </NuxtLink>
    </div>

    <p class="text-xs text-surface-500 dark:text-surface-400 mb-3">
      {{ season?.name }} · осталось {{ season?.daysLeft }} дн.
    </p>

    <!-- Tier + progress -->
    <div class="flex items-center gap-3 mb-2">
      <div class="flex items-center justify-center size-11 shrink-0 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
        <span class="text-base font-bold">{{ currentTier }}</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between text-xs mb-1">
          <span class="font-medium text-surface-700 dark:text-surface-300">Тир {{ currentTier }}/{{ data.tierCount }}</span>
          <span class="text-surface-400">{{ sxp }} SXP</span>
        </div>
        <div class="h-2 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
          <div class="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all" :style="{ width: `${tierProgress}%` }" />
        </div>
        <p v-if="nextTier" class="text-[11px] text-surface-400 mt-1">
          До тира {{ nextTier.tier }}: {{ nextTier.remaining }} SXP
        </p>
      </div>
    </div>

    <!-- Claimable -->
    <NuxtLink
      v-if="claimable > 0"
      to="/dashboard/huntpass"
      class="mt-2 flex items-center gap-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium px-3 py-2 transition-colors no-underline"
    >
      <Gift class="size-4" />
      Забрать награды: {{ claimable }}
    </NuxtLink>
  </div>
</template>
