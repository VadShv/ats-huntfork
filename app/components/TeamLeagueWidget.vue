<script setup lang="ts">
import { Users, Crown } from 'lucide-vue-next'

interface Standing {
  rank: number
  teamId: string
  name: string
  color: string
  memberCount: number
  totalRp: number
  avgRp: number
  topContributor: { userId: string; name: string; rp: number } | null
}
interface LeagueResponse { season: { name: string }; standings: Standing[]; myTeamId: string | null }

const { data } = useFetch<LeagueResponse>('/api/teams/league', {
  headers: useRequestHeaders(['cookie']),
})

const standings = computed(() => data.value?.standings ?? [])
const myTeamId = computed(() => data.value?.myTeamId)
</script>

<template>
  <div v-if="data && standings.length" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <Users class="size-5 text-brand-500" />
        <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">Лига команд</span>
      </div>
      <NuxtLink to="/dashboard/settings/league?tab=team" class="text-xs text-brand-600 dark:text-brand-400 hover:underline">Управление</NuxtLink>
    </div>

    <div class="space-y-2">
      <div
        v-for="t in standings.slice(0, 6)"
        :key="t.teamId"
        class="flex items-center gap-3 rounded-lg px-2.5 py-2"
        :class="t.teamId === myTeamId ? 'bg-brand-50 dark:bg-brand-950/30' : ''"
      >
        <span class="text-sm font-bold w-5 text-center" :class="t.rank === 1 ? 'text-amber-500' : 'text-surface-400'">
          {{ t.rank }}
        </span>
        <span class="size-3 rounded-full shrink-0" :style="{ backgroundColor: t.color }" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-medium text-surface-900 dark:text-surface-100 truncate">{{ t.name }}</span>
            <Crown v-if="t.rank === 1" class="size-3 text-amber-500 shrink-0" />
          </div>
          <p class="text-[10px] text-surface-400">{{ t.memberCount }} чел. · топ: {{ t.topContributor?.name }}</p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-xs font-semibold text-surface-700 dark:text-surface-300">{{ t.avgRp }}</p>
          <p class="text-[9px] text-surface-400">avg RP</p>
        </div>
      </div>
    </div>
  </div>
</template>
