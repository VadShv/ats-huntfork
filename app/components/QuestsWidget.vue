<script setup lang="ts">
import { Target, Gift, Check, Zap } from 'lucide-vue-next'

interface Quest {
  id: string
  key: string
  type: string
  category: string
  title: string
  description: string
  target: number
  sxpReward: number
  isQuality: boolean
  progress: number
  completed: boolean
  claimed: boolean
}
interface QuestsResponse { daily: Quest[]; weekly: Quest[]; claimable: number }

const { data, refresh } = useFetch<QuestsResponse>('/api/quests', {
  headers: useRequestHeaders(['cookie']),
})
const toast = useToast()
const claiming = ref<string | null>(null)

async function claim(q: Quest) {
  claiming.value = q.id
  try {
    const res = await $fetch<{ sxpAwarded: number }>('/api/quests/claim', { method: 'POST', body: { id: q.id } })
    toast.success(`Цель выполнена: +${res.sxpAwarded} SXP`)
    await refresh()
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Не удалось забрать награду')
  } finally {
    claiming.value = null
  }
}

const daily = computed(() => data.value?.daily ?? [])
const weekly = computed(() => data.value?.weekly ?? [])

const catColors: Record<string, string> = {
  throughput: 'text-blue-500',
  responsiveness: 'text-emerald-500',
  hygiene: 'text-amber-500',
  quality: 'text-violet-500',
  progression: 'text-brand-500',
  focus: 'text-rose-500',
}

function pct(q: Quest) {
  return Math.min(100, Math.round((q.progress / q.target) * 100))
}
</script>

<template>
  <div v-if="data" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <Target class="size-5 text-brand-500" />
        <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">Цели дня</span>
      </div>
      <span v-if="data.claimable > 0" class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-600 text-white">
        {{ data.claimable }} к получению
      </span>
    </div>

    <div class="space-y-2.5">
      <div v-for="q in daily" :key="q.id" class="flex items-center gap-3">
        <div class="flex items-center justify-center size-8 shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800">
          <Zap class="size-4" :class="catColors[q.category] || 'text-surface-400'" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-medium text-surface-900 dark:text-surface-100 truncate">{{ q.title }}</span>
            <span v-if="q.isQuality" class="text-[9px]">⭐</span>
          </div>
          <div class="h-1.5 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden mt-1">
            <div class="h-full rounded-full transition-all" :class="q.completed ? 'bg-success-500' : 'bg-brand-500'" :style="{ width: `${pct(q)}%` }" />
          </div>
        </div>
        <div class="shrink-0 text-right">
          <span v-if="q.claimed" class="inline-flex items-center gap-0.5 text-[11px] text-success-600 dark:text-success-400"><Check class="size-3" /></span>
          <button
            v-else-if="q.completed"
            type="button"
            :disabled="claiming === q.id"
            class="inline-flex items-center gap-1 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-[10px] font-medium px-2 py-1 transition-colors"
            @click="claim(q)"
          >
            <Gift class="size-3" /> +{{ q.sxpReward }}
          </button>
          <span v-else class="text-[11px] text-surface-400">{{ q.progress }}/{{ q.target }}</span>
        </div>
      </div>
    </div>

    <!-- Weekly summary -->
    <div v-if="weekly.length" class="mt-3 pt-3 border-t border-surface-100 dark:border-surface-800">
      <p class="text-[11px] text-surface-400 mb-1">Недельные</p>
      <div class="flex items-center gap-1.5 flex-wrap">
        <span
          v-for="q in weekly"
          :key="q.id"
          class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full"
          :class="q.claimed ? 'bg-success-50 dark:bg-success-950/40 text-success-600 dark:text-success-400' : q.completed ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400' : 'bg-surface-100 dark:bg-surface-800 text-surface-500'"
        >
          {{ q.title }} {{ q.progress }}/{{ q.target }}
        </span>
      </div>
    </div>
  </div>
</template>
