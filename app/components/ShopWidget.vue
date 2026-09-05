<script setup lang="ts">
import { Coins, ShoppingBag, ChevronRight } from 'lucide-vue-next'

interface WalletResponse {
  balance: number
  transactions: { amount: number; reason: string; reasonLabel: string; createdAt: string }[]
}

const { data } = useFetch<WalletResponse>('/api/wallet', { headers: useRequestHeaders(['cookie']) })
const balance = computed(() => data.value?.balance ?? 0)
const recent = computed(() => data.value?.transactions.slice(0, 3) ?? [])
</script>

<template>
  <div v-if="data" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <Coins class="size-5 text-amber-500" />
        <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">Монеты</span>
      </div>
      <NuxtLink to="/dashboard/shop" class="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-0.5">
        Магазин <ChevronRight class="size-3" />
      </NuxtLink>
    </div>

    <div class="flex items-center gap-2 mb-3">
      <span class="text-2xl font-bold text-surface-900 dark:text-surface-100">{{ balance }}</span>
      <Coins class="size-5 text-amber-500" />
    </div>

    <div v-if="recent.length" class="space-y-1 pt-2 border-t border-surface-100 dark:border-surface-800">
      <div v-for="(t, i) in recent" :key="i" class="flex items-center justify-between text-[11px]">
        <span class="text-surface-500 dark:text-surface-400">{{ t.reasonLabel }}</span>
        <span :class="t.amount >= 0 ? 'text-success-600 dark:text-success-400' : 'text-surface-400'">{{ t.amount >= 0 ? '+' : '' }}{{ t.amount }}</span>
      </div>
    </div>
    <NuxtLink v-else to="/dashboard/shop" class="flex items-center gap-1.5 text-xs text-surface-400 hover:text-brand-600">
      <ShoppingBag class="size-3.5" /> Открыть магазин косметики
    </NuxtLink>
  </div>
</template>
