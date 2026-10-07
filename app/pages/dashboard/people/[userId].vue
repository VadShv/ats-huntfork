<script setup lang="ts">
/**
 * Публичный профиль участника организации (docs/design-profile-and-token-limits.md §2.3):
 * усечённая информация — роль, команда, ранг, достижения, метрики найма, Хант-пасс,
 * похвалы и открытые вакансии (в scope смотрящего). Никаких email, расхода ИИ и лимитов.
 */
import { ArrowLeft, Trophy, Briefcase, Heart, Sparkles, Settings } from 'lucide-vue-next'

definePageMeta({})
useSeoMeta({ title: 'Профиль участника', robots: 'noindex, nofollow' })

const route = useRoute()
const localePath = useLocalePath()
const userId = computed(() => String(route.params.userId ?? ''))
const PROFILE_URL = computed<string>(() => `/api/people/${userId.value}/profile`)
const reqHeaders = useRequestHeaders(['cookie'])

const { data, status, error } = await useAsyncData<any>(() => `people-profile-${userId.value}`, () => $fetch(PROFILE_URL.value, { headers: reqHeaders }), { watch: [userId] })

useSeoMeta({ title: () => data.value?.user?.name ? `${data.value.user.name} — профиль` : 'Профиль участника' })

const initials = computed(() => (data.value?.user?.name ?? '?').split(' ').map((p: string) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase())
const frameStyle = computed(() => data.value?.equipped?.frame?.value ? { background: data.value.equipped.frame.value } : undefined)
const accentStyle = computed(() => data.value?.equipped?.accent?.value ? { background: data.value.equipped.accent.value } : undefined)

function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('ru-RU', opts).format(new Date(iso))
}
function fmtHours(h: number | null): string {
  if (h === null || h === undefined) return '—'
  return h < 24 ? `${Math.round(h)} ч` : `${(h / 24).toFixed(1)} дн`
}
const tierLabel: Record<string, string> = { bronze: 'Бронза', silver: 'Серебро', gold: 'Золото', platinum: 'Платина', legendary: 'Легенда' }
const tierCls: Record<string, string> = {
  bronze: 'border-amber-700/40 bg-amber-50 dark:bg-amber-950/30',
  silver: 'border-slate-300 bg-slate-50 dark:bg-slate-900/40',
  gold: 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/30',
  platinum: 'border-cyan-300/60 bg-cyan-50 dark:bg-cyan-950/30',
  legendary: 'border-fuchsia-300/60 bg-fuchsia-50 dark:bg-fuchsia-950/30',
}
const metricCards = computed(() => {
  const m = data.value?.metrics
  if (!m) return []
  return [
    { label: 'Наймы', season: m.season.hires, all: m.allTime.hires },
    { label: 'Офферы', season: m.season.offers, all: m.allTime.offers },
    { label: 'Интервью', season: m.season.interviews, all: m.allTime.interviews },
    { label: 'Закрыто вакансий', season: m.season.vacanciesClosed, all: m.allTime.vacanciesClosed },
    { label: 'Среднее время ответа', season: fmtHours(m.season.avgResponseHours), all: fmtHours(m.allTime.avgResponseHours) },
  ]
})
const trendMax = computed(() => Math.max(1, ...(data.value?.rank?.trend ?? [0])))
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <div class="mb-4">
      <button type="button" class="inline-flex items-center gap-1 text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300" @click="$router.back()">
        <ArrowLeft class="size-3.5" /> Назад
      </button>
    </div>

    <div v-if="status === 'pending' && !data" class="text-sm text-surface-400 py-10 text-center">Загрузка профиля…</div>
    <div v-else-if="error || !data" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-8 text-center">
      <p class="text-sm font-medium text-surface-700 dark:text-surface-200">Участник не найден</p>
      <p class="text-xs text-surface-400 mt-1">Возможно, он больше не состоит в организации.</p>
    </div>

    <template v-else>
      <!-- Шапка -->
      <section class="relative overflow-hidden rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
        <div class="h-20" :style="accentStyle" :class="accentStyle ? '' : 'bg-gradient-to-r from-brand-100 to-surface-100 dark:from-brand-950 dark:to-surface-800'" />
        <div class="px-5 sm:px-6 pb-5 -mt-10 flex flex-col sm:flex-row sm:items-end gap-4">
          <div class="relative shrink-0">
            <div class="size-20 rounded-full p-[3px]" :style="frameStyle" :class="frameStyle ? '' : 'bg-white dark:bg-surface-900'">
              <div class="size-full rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden flex items-center justify-center text-xl font-semibold text-surface-500 ring-2 ring-white dark:ring-surface-900">
                <img v-if="data.user.image" :src="data.user.image" :alt="data.user.name" class="size-full object-cover">
                <span v-else>{{ initials }}</span>
              </div>
            </div>
            <span v-if="data.rank?.division" class="absolute -bottom-1 -right-1 text-lg" :title="data.rank.division.name">{{ data.rank.division.icon }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50 truncate">{{ data.user.name }}</h1>
              <span v-if="data.equipped.title" class="text-xs px-2 py-0.5 rounded-full bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-medium">{{ data.equipped.title.value }}</span>
            </div>
            <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
              {{ data.user.roleLabel }}
              <template v-if="data.team"> · <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full inline-block" :style="{ background: data.team.color }" />{{ data.team.name }}</span></template>
              <template v-if="data.user.memberSince"> · в организации с {{ fmtDate(data.user.memberSince, { month: 'long', year: 'numeric' }) }}</template>
            </p>
          </div>
          <NuxtLink v-if="data.user.isMe" :to="localePath('/dashboard/settings/account')" class="inline-flex items-center gap-1.5 text-xs text-brand-600 dark:text-brand-400 hover:underline shrink-0">
            <Settings class="size-3.5" /> Личный кабинет
          </NuxtLink>
        </div>
      </section>

      <div class="grid lg:grid-cols-3 gap-5 mt-5">
        <!-- Ранг -->
        <section class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
          <h2 class="text-sm font-semibold flex items-center gap-1.5 mb-3"><Trophy class="size-4" /> Ранг · {{ data.season.name }}</h2>
          <div class="flex items-center gap-3">
            <span class="text-3xl">{{ data.rank.division.icon }}</span>
            <div class="min-w-0">
              <p class="text-base font-semibold text-surface-900 dark:text-surface-50">
                {{ data.rank.division.name }}<template v-if="!data.rank.division.isLegend && data.rank.division.subrank"> {{ data.rank.division.subrank }}</template>
              </p>
              <p class="text-xs text-surface-500">
                {{ data.rank.rp }} RP
                <template v-if="data.rank.position"> · {{ data.rank.position }} из {{ data.rank.total }}</template>
                <template v-if="data.rank.placement"> · калибровка</template>
              </p>
            </div>
          </div>
          <div v-if="data.rank.trend.length > 1" class="mt-4 flex items-end gap-1 h-10" title="RP по неделям">
            <div v-for="(v, i) in data.rank.trend" :key="i" class="flex-1 rounded-sm bg-brand-400/70 dark:bg-brand-500/60" :style="{ height: `${Math.max(6, (v / trendMax) * 100)}%` }" />
          </div>
          <div class="mt-4 pt-3 border-t border-surface-100 dark:border-surface-800 flex items-center justify-between text-xs">
            <span class="text-surface-500 flex items-center gap-1"><Sparkles class="size-3.5" /> Хант-пасс</span>
            <span class="font-medium text-surface-700 dark:text-surface-200">уровень {{ data.huntpass.tier }} / {{ data.huntpass.tierCount }} · {{ data.huntpass.sxp }} SXP</span>
          </div>
        </section>

        <!-- Метрики -->
        <section class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 lg:col-span-2">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-semibold flex items-center gap-1.5"><Briefcase class="size-4" /> Результаты найма</h2>
            <span class="text-[11px] text-surface-400">сезон / всё время</span>
          </div>
          <dl class="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div v-for="c in metricCards" :key="c.label" class="rounded-xl bg-surface-50 dark:bg-surface-800/50 p-3">
              <dt class="text-[11px] text-surface-500 leading-tight">{{ c.label }}</dt>
              <dd class="mt-1 text-lg font-semibold text-surface-900 dark:text-surface-50 leading-none">{{ c.season }}</dd>
              <dd class="text-[11px] text-surface-400 mt-1">всего {{ c.all }}</dd>
            </div>
          </dl>
        </section>

        <!-- Достижения -->
        <section class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 lg:col-span-2">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-semibold">Достижения</h2>
            <span class="text-xs text-surface-500">{{ data.achievements.earnedCount }} из {{ data.achievements.totalCount }} · ур. {{ data.achievements.level.level }} «{{ data.achievements.level.title }}»</span>
          </div>
          <p v-if="!data.achievements.items.length" class="text-xs text-surface-400 py-4 text-center">Достижений пока нет.</p>
          <ul v-else class="grid sm:grid-cols-2 gap-2">
            <li v-for="a in data.achievements.items" :key="a.key" class="flex items-start gap-2.5 rounded-xl border p-2.5" :class="tierCls[a.tier] ?? 'border-surface-200 dark:border-surface-800'">
              <span class="text-xl leading-none">{{ a.icon }}</span>
              <div class="min-w-0">
                <p class="text-xs font-medium text-surface-900 dark:text-surface-100 truncate">{{ a.name }}</p>
                <p class="text-[11px] text-surface-500 line-clamp-2">{{ a.description }}</p>
                <p class="text-[10px] text-surface-400 mt-0.5">{{ tierLabel[a.tier] ?? a.tier }} · {{ a.points }} XP · {{ fmtDate(a.earnedAt) }}</p>
              </div>
            </li>
          </ul>
        </section>

        <!-- Похвалы + вакансии -->
        <div class="space-y-5">
          <section class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
            <h2 class="text-sm font-semibold flex items-center gap-1.5 mb-3"><Heart class="size-4" /> Похвалы <span class="text-surface-400 font-normal">· {{ data.kudos.total }}</span></h2>
            <p v-if="!data.kudos.last.length" class="text-xs text-surface-400">Пока никто не похвалил.</p>
            <ul v-else class="space-y-2">
              <li v-for="k in data.kudos.last" :key="k.id" class="text-xs">
                <NuxtLink :to="localePath(`/dashboard/people/${k.fromUserId}`)" class="font-medium text-surface-800 dark:text-surface-100 hover:underline">{{ k.fromName }}</NuxtLink>
                <span class="text-surface-400"> · {{ fmtDate(k.createdAt) }}</span>
                <p v-if="k.reason" class="text-surface-600 dark:text-surface-300 mt-0.5">«{{ k.reason }}»</p>
              </li>
            </ul>
          </section>

          <section class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
            <h2 class="text-sm font-semibold mb-3">Вакансии в работе</h2>
            <p v-if="!data.openJobs.length" class="text-xs text-surface-400">Нет открытых вакансий, где участник — основной рекрутер (или они вне вашего доступа).</p>
            <ul v-else class="space-y-1.5">
              <li v-for="j in data.openJobs" :key="j.id">
                <NuxtLink :to="localePath(`/dashboard/jobs/${j.id}`)" class="text-xs text-brand-600 dark:text-brand-400 hover:underline truncate block">{{ j.title }}</NuxtLink>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>
