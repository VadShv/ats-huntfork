<script setup lang="ts">
import { Ticket, Gift, Check, Lock, Star } from 'lucide-vue-next'

definePageMeta({})
useSeoMeta({ title: 'HuntPass', description: 'Сезонный трек рекрутера' })

interface TierReward { type: string; label: string; icon: string; amount?: number }
interface Tier { tier: number; requiredSxp: number; free: TierReward; premium: TierReward | null; reached: boolean; claimed: boolean }
interface HuntPassResponse {
  season: { name: string; quarter: number; year: number; theme: string; startsAt: string; endsAt: string; daysLeft: number }
  sxp: number
  breakdown: { hires: number; offers: number; interviews: number; vacanciesClosed: number; qualityFactor: number }
  currentTier: number
  tierCount: number
  isPremium: boolean
  nextTier: { tier: number; requiredSxp: number; remaining: number } | null
  tiers: Tier[]
}

const { data, refresh } = useFetch<HuntPassResponse>('/api/huntpass', {
  headers: useRequestHeaders(['cookie']),
})
const toast = useToast()
const claiming = ref<number | null>(null)

async function claim(tier: number) {
  claiming.value = tier
  try {
    const res = await $fetch<{ rewards: TierReward[] }>('/api/huntpass/claim', {
      method: 'POST',
      body: { tier },
    })
    const labels = res.rewards.map(r => `${r.icon} ${r.label}`).join(', ')
    toast.success(`Награда получена: ${labels}`)
    await refresh()
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Не удалось забрать награду')
  } finally {
    claiming.value = null
  }
}

const season = computed(() => data.value?.season)
const breakdown = computed(() => data.value?.breakdown)
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <div v-if="data">
      <!-- Header -->
      <div class="mb-6 rounded-2xl border border-surface-200 dark:border-surface-800 bg-gradient-to-br from-brand-500 to-brand-700 text-white p-6">
        <div class="flex items-center gap-2 mb-1">
          <Ticket class="size-5" />
          <h1 class="text-lg font-semibold">HuntPass</h1>
          <span v-if="data.isPremium" class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-400 text-surface-900">PREMIUM</span>
        </div>
        <p class="text-sm text-white/80">{{ season?.name }} · осталось {{ season?.daysLeft }} дней</p>
        <div class="mt-4 flex items-end gap-6">
          <div>
            <p class="text-3xl font-bold">Тир {{ data.currentTier }}<span class="text-lg text-white/60">/{{ data.tierCount }}</span></p>
            <p class="text-sm text-white/80">{{ data.sxp }} SXP</p>
          </div>
          <div v-if="data.nextTier" class="text-sm text-white/80">
            До тира {{ data.nextTier.tier }}: <span class="font-semibold text-white">{{ data.nextTier.remaining }} SXP</span>
          </div>
        </div>
      </div>

      <!-- SXP breakdown -->
      <div class="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-3 text-center">
          <p class="text-xl font-bold text-surface-900 dark:text-surface-100">{{ breakdown?.hires }}</p>
          <p class="text-[11px] text-surface-400">наймов ×100</p>
        </div>
        <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-3 text-center">
          <p class="text-xl font-bold text-surface-900 dark:text-surface-100">{{ breakdown?.offers }}</p>
          <p class="text-[11px] text-surface-400">офферов ×40</p>
        </div>
        <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-3 text-center">
          <p class="text-xl font-bold text-surface-900 dark:text-surface-100">{{ breakdown?.interviews }}</p>
          <p class="text-[11px] text-surface-400">интервью ×20</p>
        </div>
        <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-3 text-center">
          <p class="text-xl font-bold text-surface-900 dark:text-surface-100">{{ breakdown?.vacanciesClosed }}</p>
          <p class="text-[11px] text-surface-400">вакансий ×80</p>
        </div>
      </div>
      <p v-if="breakdown && breakdown.qualityFactor !== 1" class="text-xs text-surface-500 dark:text-surface-400 mb-4 -mt-2">
        Множитель качества офферов: ×{{ breakdown.qualityFactor }}
      </p>

      <!-- Tier track -->
      <div class="space-y-2">
        <div
          v-for="t in data.tiers"
          :key="t.tier"
          class="rounded-xl border p-3 flex items-center gap-3"
          :class="t.reached ? 'border-brand-200 dark:border-brand-800 bg-white dark:bg-surface-900' : 'border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50'"
        >
          <!-- Tier badge -->
          <div
            class="flex items-center justify-center size-10 shrink-0 rounded-lg font-bold"
            :class="t.reached ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white' : 'bg-surface-100 dark:bg-surface-800 text-surface-400'"
          >
            {{ t.tier }}
          </div>

          <!-- Free reward -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-sm">{{ t.free.icon }}</span>
              <span class="text-sm text-surface-700 dark:text-surface-300 truncate">{{ t.free.label }}</span>
            </div>
            <p class="text-[11px] text-surface-400">{{ t.requiredSxp }} SXP</p>
          </div>

          <!-- Premium reward -->
          <div v-if="t.premium" class="hidden sm:flex items-center gap-1.5 min-w-0 flex-1">
            <Star class="size-3 text-yellow-500 shrink-0" />
            <span class="text-sm">{{ t.premium.icon }}</span>
            <span class="text-xs truncate" :class="data.isPremium ? 'text-surface-600 dark:text-surface-400' : 'text-surface-300 dark:text-surface-600'">{{ t.premium.label }}</span>
          </div>

          <!-- Action -->
          <div class="shrink-0">
            <span v-if="t.claimed" class="inline-flex items-center gap-1 text-xs text-success-600 dark:text-success-400">
              <Check class="size-3.5" /> Получено
            </span>
            <button
              v-else-if="t.reached"
              type="button"
              :disabled="claiming === t.tier"
              class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 transition-colors"
              @click="claim(t.tier)"
            >
              <Gift class="size-3.5" /> Забрать
            </button>
            <Lock v-else class="size-4 text-surface-300 dark:text-surface-600" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
