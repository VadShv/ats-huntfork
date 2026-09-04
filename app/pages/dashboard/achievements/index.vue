<script setup lang="ts">
import { Trophy, Lock, Star, Crown } from 'lucide-vue-next'

definePageMeta({})

useSeoMeta({
  title: 'Достижения',
  description: 'Достижения и рейтинг рекрутеров',
})

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

interface LeaderboardEntry {
  rank: number
  userId: string
  name: string
  xp: number
  level: { level: number; title: string }
}

const { data: achData } = useFetch<{ achievements: AchievementItem[]; level: { level: number; title: string; xp: number; progress: number } }>('/api/achievements', {
  headers: useRequestHeaders(['cookie']),
})
const { data: lbData } = useFetch<{ leaderboard: LeaderboardEntry[] }>('/api/achievements/leaderboard', {
  headers: useRequestHeaders(['cookie']),
})

const achievements = computed(() => achData.value?.achievements ?? [])
const level = computed(() => achData.value?.level)
const leaderboard = computed(() => lbData.value?.leaderboard ?? [])

const categories = [
  { id: 'all', label: 'Все' },
  { id: 'vacancies', label: 'Вакансии' },
  { id: 'offers', label: 'Офферы' },
  { id: 'hires', label: 'Наймы' },
  { id: 'interviews', label: 'Интервью' },
  { id: 'speed', label: 'Скорость' },
  { id: 'streak', label: 'Стрик' },
]
const activeCategory = ref('all')
const filtered = computed(() =>
  activeCategory.value === 'all'
    ? achievements.value
    : achievements.value.filter(a => a.category === activeCategory.value),
)

const earnedCount = computed(() => achievements.value.filter(a => a.earned).length)
const totalXp = computed(() => achievements.value.filter(a => a.earned).reduce((s, a) => s + a.points, 0))

const tierColors: Record<string, string> = {
  bronze: 'from-amber-600 to-amber-800',
  silver: 'from-slate-400 to-slate-600',
  gold: 'from-yellow-400 to-yellow-600',
  platinum: 'from-cyan-300 to-violet-400',
}
const tierBorder: Record<string, string> = {
  bronze: 'border-amber-300 dark:border-amber-700',
  silver: 'border-slate-300 dark:border-slate-600',
  gold: 'border-yellow-300 dark:border-yellow-600',
  platinum: 'border-cyan-300 dark:border-violet-500',
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50 flex items-center gap-2">
        <Trophy class="size-5 text-brand-500" />
        Достижения
      </h1>
      <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
        {{ earnedCount }} из {{ achievements.length }} открыто · {{ totalXp }} XP всего
      </p>
    </div>

    <!-- Level + progress -->
    <div v-if="level" class="mb-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center size-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
            <span class="text-lg font-bold">{{ level.level }}</span>
          </div>
          <div>
            <p class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ level.title }}</p>
            <p class="text-xs text-surface-400">{{ level.xp }} XP</p>
          </div>
        </div>
        <div class="text-right">
          <p class="text-xs text-surface-400">До следующего уровня</p>
          <p class="text-sm font-medium text-surface-600 dark:text-surface-300">{{ level.progress }}%</p>
        </div>
      </div>
      <div class="h-2.5 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
        <div class="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all" :style="{ width: `${level.progress}%` }" />
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Achievements grid -->
      <div class="lg:col-span-2">
        <!-- Category filter -->
        <div class="flex flex-wrap gap-1.5 mb-4">
          <button
            v-for="cat in categories"
            :key="cat.id"
            type="button"
            class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            :class="activeCategory === cat.id
              ? 'bg-brand-600 text-white'
              : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'"
            @click="activeCategory = cat.id"
          >
            {{ cat.label }}
          </button>
        </div>

        <!-- Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            v-for="a in filtered"
            :key="a.key"
            class="rounded-xl border p-4 transition-all"
            :class="a.earned
              ? `${tierBorder[a.tier]} bg-white dark:bg-surface-900`
              : 'border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50'"
          >
            <div class="flex items-start gap-3">
              <div
                v-if="a.earned"
                class="flex items-center justify-center size-10 rounded-lg bg-gradient-to-br shrink-0"
                :class="tierColors[a.tier]"
              >
                <span class="text-lg">{{ a.icon }}</span>
              </div>
              <div v-else-if="a.isHidden" class="flex items-center justify-center size-10 rounded-lg bg-surface-100 dark:bg-surface-800 shrink-0">
                <span class="text-lg">❓</span>
              </div>
              <div v-else class="flex items-center justify-center size-10 rounded-lg bg-surface-100 dark:bg-surface-800 shrink-0">
                <Lock class="size-4 text-surface-400" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <p class="text-sm font-medium truncate" :class="a.earned ? 'text-surface-900 dark:text-surface-100' : 'text-surface-500 dark:text-surface-400'">
                    {{ a.isHidden && !a.earned ? 'Секретное достижение' : a.name }}
                  </p>
                </div>
                <p class="text-[11px] text-surface-400 mt-0.5">{{ a.isHidden && !a.earned ? 'Откроется при выполнении условия' : a.description }}</p>
                <div class="flex items-center gap-2 mt-2">
                  <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full" :class="a.earned ? 'bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400' : 'bg-surface-100 text-surface-400 dark:bg-surface-800'">
                    +{{ a.points }} XP
                  </span>
                  <span v-if="a.earned" class="text-[10px] text-success-600 dark:text-success-400">✓ Открыто</span>
                  <span v-else-if="!a.isHidden" class="text-[10px] text-surface-400">{{ a.currentValue }}/{{ a.threshold }}</span>
                </div>
                <!-- Progress bar -->
                <div v-if="!a.earned && !a.isHidden && a.progress > 0" class="h-1.5 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden mt-2">
                  <div class="h-full rounded-full bg-surface-300 dark:bg-surface-600" :style="{ width: `${a.progress}%` }" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Leaderboard -->
      <div>
        <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 sticky top-6">
          <div class="flex items-center gap-2 mb-4">
            <Crown class="size-4 text-amber-500" />
            <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">Рейтинг</span>
          </div>
          <div v-if="!leaderboard.length" class="text-center py-6">
            <p class="text-xs text-surface-400">Пока нет данных — закройте первую вакансию!</p>
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="entry in leaderboard.slice(0, 10)"
              :key="entry.userId"
              class="flex items-center gap-3 rounded-lg px-3 py-2"
              :class="entry.rank <= 3 ? 'bg-amber-50 dark:bg-amber-950/30' : ''"
            >
              <span class="text-sm font-bold w-6 text-center" :class="entry.rank === 1 ? 'text-amber-500' : entry.rank === 2 ? 'text-slate-400' : entry.rank === 3 ? 'text-amber-700' : 'text-surface-400'">
                {{ entry.rank }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-surface-900 dark:text-surface-100 truncate">{{ entry.name }}</p>
                <p class="text-[10px] text-surface-400">Ур.{{ entry.level.level }} · {{ entry.level.title }}</p>
              </div>
              <span class="text-xs font-semibold text-surface-600 dark:text-surface-300 shrink-0">{{ entry.xp }} XP</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
