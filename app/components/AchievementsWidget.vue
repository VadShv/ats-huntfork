<script setup lang="ts">
import { Trophy, Lock, ChevronRight } from 'lucide-vue-next'

interface AchievementItem {
  key: string
  name: string
  description: string
  category: string
  tier: string
  icon: string
  points: number
  isHidden: boolean
  earned: boolean
  earnedAt: string | null
  currentValue: number
  threshold: number
  progress: number
}

interface AchievementsResponse {
  achievements: AchievementItem[]
  level: { level: number; title: string; xp: number; progress: number; nextLevelXp: number | null }
  newlyEarned: { key: string; name: string; icon: string; points: number }[]
}

const { data } = useFetch<AchievementsResponse>('/api/achievements', {
  headers: useRequestHeaders(['cookie']),
})

const level = computed(() => data.value?.level)
const achievements = computed(() => data.value?.achievements ?? [])
const earned = computed(() => achievements.value.filter(a => a.earned))
const recent = computed(() => earned.value.slice(0, 4))
const inProgress = computed(() =>
  achievements.value.filter(a => !a.earned && !a.isHidden && a.progress > 0).slice(0, 3),
)

const toast = useToast()
watch(() => data.value?.newlyEarned, (newly) => {
  if (newly?.length) {
    for (const a of newly) {
      toast.success(`🏆 ${a.name}`, { description: `+${a.points} XP` })
    }
  }
}, { immediate: true })

const tierColors: Record<string, string> = {
  bronze: 'from-amber-600 to-amber-800',
  silver: 'from-slate-400 to-slate-600',
  gold: 'from-yellow-400 to-yellow-600',
  platinum: 'from-cyan-300 to-violet-400',
}
</script>

<template>
  <div v-if="data" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
    <!-- Header: level + XP -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <Trophy class="size-5 text-brand-500" />
        <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">Достижения</span>
      </div>
      <NuxtLink to="/dashboard/achievements" class="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-0.5">
        Все <ChevronRight class="size-3" />
      </NuxtLink>
    </div>

    <!-- Level bar -->
    <div v-if="level" class="mb-4">
      <div class="flex items-center justify-between text-xs mb-1">
        <span class="font-medium text-surface-700 dark:text-surface-300">Ур.{{ level.level }} · {{ level.title }}</span>
        <span class="text-surface-400">{{ level.xp }} XP</span>
      </div>
      <div class="h-2 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
        <div class="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all" :style="{ width: `${level.progress}%` }" />
      </div>
    </div>

    <!-- Earned achievements -->
    <div v-if="recent.length" class="space-y-2 mb-3">
      <div v-for="a in recent" :key="a.key" class="flex items-center gap-2.5">
        <div class="flex items-center justify-center size-8 rounded-lg bg-gradient-to-br shrink-0" :class="tierColors[a.tier]">
          <span class="text-sm">{{ a.icon }}</span>
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium text-surface-900 dark:text-surface-100 truncate">{{ a.name }}</p>
          <p class="text-[11px] text-surface-400">+{{ a.points }} XP</p>
        </div>
        <span class="text-[10px] text-success-600 dark:text-success-400 font-medium">✓</span>
      </div>
    </div>

    <!-- In progress -->
    <div v-if="inProgress.length" class="space-y-2 pt-3 border-t border-surface-100 dark:border-surface-800">
      <div v-for="a in inProgress" :key="a.key" class="flex items-center gap-2.5">
        <div class="flex items-center justify-center size-8 rounded-lg bg-surface-100 dark:bg-surface-800 shrink-0">
          <Lock class="size-3.5 text-surface-400" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium text-surface-600 dark:text-surface-400 truncate">{{ a.name }}</p>
          <div class="h-1.5 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden mt-1">
            <div class="h-full rounded-full bg-surface-300 dark:bg-surface-600" :style="{ width: `${a.progress}%` }" />
          </div>
        </div>
        <span class="text-[10px] text-surface-400 shrink-0">{{ a.currentValue }}/{{ a.threshold }}</span>
      </div>
    </div>

    <!-- Empty -->
    <div v-if="!recent.length && !inProgress.length" class="text-center py-4">
      <Trophy class="size-6 mx-auto text-surface-300 dark:text-surface-600 mb-1.5" />
      <p class="text-xs text-surface-400">Достижений пока нет — закройте первую вакансию!</p>
    </div>
  </div>
</template>
