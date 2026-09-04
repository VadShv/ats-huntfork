<script setup lang="ts">
import {
  Briefcase, Users, FileText, Calendar, Plus,
  ArrowRight, TrendingUp, Clock, AlertCircle,
  Eye, UserPlus, ExternalLink,
  LayoutDashboard, Zap, ChevronDown, CircleUser,
} from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Панель',
  description: 'Ваш центр управления подбором',
})

const { activeOrg } = useCurrentOrg()
const localePath = useLocalePath()
const { track } = useTrack()
const { formatPersonName } = useOrgSettings()

onMounted(() => track('dashboard_viewed'))

// ─────────────────────────────────────────────
// Fetch dashboard stats
// ─────────────────────────────────────────────

const {
  counts,
  jobsByStatus,
  recentApplications,
  topJobs,
  fetchStatus,
  error,
  refresh,
} = useDashboard()

// ─────────────────────────────────────────────
// Upcoming interviews (next 7 days)
// ─────────────────────────────────────────────

const now = new Date()
// Truncate to start-of-day so the useFetch key is identical on server & client
// (prevents SSR/hydration mismatch from sub-second timestamp drift)
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
const weekFromToday = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)

const { interviews: upcomingInterviews } = useInterviews({
  status: 'scheduled',
  from: today.toISOString(),
  to: weekFromToday.toISOString(),
  limit: 5,
})

// ─────────────────────────────────────────────
// Derived data
// ─────────────────────────────────────────────

const { t } = useI18n()

// ─── Sprint 20.2: группировка вакансий по рекрутерам для owner/admin ───
const { role: orgRole } = usePermission({ job: ['read'] })
const groupTopJobs = computed(() => orgRole.value === 'owner' || orgRole.value === 'admin')

interface TopJobGroup {
  key: string
  name: string | null
  jobs: typeof topJobs.value
}

const topJobGroups = computed<TopJobGroup[]>(() => {
  // Рекрутер видит плоский список своих вакансий — псевдогруппа без заголовка
  if (!groupTopJobs.value) {
    return [{ key: 'all', name: null, jobs: topJobs.value }]
  }
  const map = new Map<string, TopJobGroup>()
  const withoutRecruiter: typeof topJobs.value = []
  for (const j of topJobs.value) {
    const recs = (j as { recruiters?: Array<{ userId: string, name: string }> }).recruiters ?? []
    if (recs.length === 0) {
      withoutRecruiter.push(j)
      continue
    }
    for (const r of recs) {
      let g = map.get(r.userId)
      if (!g) {
        g = { key: r.userId, name: r.name || 'Без имени', jobs: [] }
        map.set(r.userId, g)
      }
      g.jobs.push(j)
    }
  }
  const groups = [...map.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  if (withoutRecruiter.length > 0) {
    groups.push({ key: '__none__', name: 'Без рекрутера', jobs: withoutRecruiter })
  }
  return groups
})

const DASH_COLLAPSE_LS_KEY = 'dashboard-recruiter-collapsed'
const collapsedRecruiters = ref<Set<string>>(new Set())

onMounted(() => {
  try {
    const raw = localStorage.getItem(DASH_COLLAPSE_LS_KEY)
    if (raw) collapsedRecruiters.value = new Set(JSON.parse(raw) as string[])
  }
  catch { /* localStorage недоступен — не критично */ }
})

function toggleRecruiterGroup(key: string) {
  const next = new Set(collapsedRecruiters.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedRecruiters.value = next
  try {
    localStorage.setItem(DASH_COLLAPSE_LS_KEY, JSON.stringify([...next]))
  }
  catch { /* игнорируем */ }
}

// ─── Sprint 10: динамические этапы воронки на карточках topJobs ───
interface JobStageChip {
  id: string
  name: string
  color: string
  type: string
  bucket: 'working' | 'rejected'
  displayOrder: number
  count: number
}

// Фаза 1 (словарь = воронка): показываем этапы для любой вакансии с воронкой,
// легаси-фолбэк по статусам полностью удалён
function jobHasStages(j: any): boolean {
  return ((j?.stages ?? []) as JobStageChip[]).length > 0
}

function jobWorkingStages(j: any): JobStageChip[] {
  return ((j?.stages ?? []) as JobStageChip[]).filter(s => s.bucket === 'working')
}

function jobRejectedTotal(j: any): number {
  return ((j?.stages ?? []) as JobStageChip[])
    .filter(s => s.bucket === 'rejected')
    .reduce((sum, s) => sum + s.count, 0)
}

function jobWorkingTotal(j: any): number {
  return jobWorkingStages(j).reduce((sum, s) => sum + s.count, 0)
}

// ─── Спринт 11.4: итоговое значение с учётом всех отказов ───
function jobGrandTotal(j: any): number {
  return jobWorkingTotal(j) + jobRejectedTotal(j)
}


const interviewTypeLabels = computed<Record<string, string>>(() => ({
  phone: t('dashboard.interviews.type.phone'),
  video: t('dashboard.interviews.type.video'),
  in_person: t('dashboard.interviews.type.in_person'),
  panel: t('dashboard.interviews.type.panel'),
  technical: t('dashboard.interviews.type.technical'),
  take_home: t('dashboard.interviews.type.take_home'),
}))

function formatRelativeDate(dateStr: string) {
  const date = new Date(dateStr)
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

  if (diffDays === 0) {
    if (diffHours <= 0) return t('dashboard.index.today')
    return t('dashboard.index.inHours', { n: diffHours })
  }
  if (diffDays === 1) return t('dashboard.index.tomorrow')
  if (diffDays < 7) return t('dashboard.index.inDays', { n: diffDays })
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const isEmpty = computed(() =>
  counts.value.openJobs === 0
  && counts.value.totalCandidates === 0
  && counts.value.totalApplications === 0,
)
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <!-- ─── Loading skeleton ─── -->
    <div v-if="fetchStatus === 'pending'">
      <!-- Header skeleton -->
      <div class="mb-10">
        <div class="h-8 w-56 bg-surface-200 dark:bg-surface-700 rounded-lg animate-pulse mb-2" />
        <div class="h-4 w-40 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
      </div>
      <!-- Stats skeleton -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <div v-for="i in 4" :key="i" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 animate-pulse">
          <div class="h-4 w-20 bg-surface-200 dark:bg-surface-700 rounded mb-4" />
          <div class="h-9 w-14 bg-surface-200 dark:bg-surface-700 rounded" />
        </div>
      </div>
      <!-- Content skeleton -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 animate-pulse">
          <div class="h-5 w-32 bg-surface-200 dark:bg-surface-700 rounded mb-6" />
          <div class="space-y-4">
            <div v-for="i in 3" :key="i" class="h-20 bg-surface-100 dark:bg-surface-800 rounded-xl" />
          </div>
        </div>
        <div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 animate-pulse">
          <div class="h-5 w-32 bg-surface-200 dark:bg-surface-700 rounded mb-6" />
          <div class="space-y-3">
            <div v-for="i in 4" :key="i" class="h-14 bg-surface-100 dark:bg-surface-800 rounded-xl" />
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Error ─── -->
    <div
      v-else-if="error"
      class="rounded-2xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/60 p-5 text-sm text-danger-700 dark:text-danger-400 flex items-center gap-3"
    >
      <AlertCircle class="size-5 shrink-0" />
      <span>{{ $t('dashboard.index.failedToLoad') }}</span>
      <button class="underline ml-auto font-medium cursor-pointer" @click="refresh()">{{ $t('dashboard.index.retry') }}</button>
    </div>

    <!-- ─── Empty state (brand new org) ─── -->
    <div v-else-if="isEmpty" class="flex flex-col items-center justify-center py-24">
      <div class="rounded-3xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-14 text-center max-w-md shadow-sm">
        <div class="mx-auto mb-8 flex items-center justify-center size-18 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/20">
          <LayoutDashboard class="size-9 text-white" />
        </div>
        <h2 class="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-3 tracking-tight">
          {{ $t('dashboard.index.welcomeTitle') }}
        </h2>
        <p class="text-sm text-surface-500 dark:text-surface-400 mb-10 leading-relaxed max-w-sm mx-auto">
          {{ $t('dashboard.index.welcomeDesc') }}
        </p>
        <NuxtLink
          :to="localePath('/dashboard/jobs/new')"
          class="inline-flex items-center gap-2.5 rounded-xl bg-brand-600 px-7 py-3.5 text-sm font-semibold text-white hover:bg-brand-700 shadow-md shadow-brand-600/20 hover:shadow-lg hover:shadow-brand-600/25 transition-all no-underline"
        >
          <Plus class="size-4" />
          {{ $t('dashboard.index.createFirstJob') }}
        </NuxtLink>
      </div>
    </div>

    <!-- ─── Dashboard content ─── -->
    <template v-else>
      <!-- ─── Header ─── -->
      <div class="flex items-center justify-between mb-6 sm:mb-10">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">{{ $t('dashboard.index.title') }}</h1>
          <p v-if="activeOrg" class="text-sm text-surface-400 dark:text-surface-500 mt-1">
            {{ activeOrg.name }}
          </p>
        </div>
        <NuxtLink
          :to="localePath('/dashboard/jobs/new')"
          class="inline-flex items-center gap-1.5 sm:gap-2 rounded-xl bg-brand-600 px-3 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-brand-700 shadow-sm shadow-brand-600/15 hover:shadow-md hover:shadow-brand-600/20 transition-all no-underline shrink-0"
        >
          <Plus class="size-4" />
          {{ $t('dashboard.index.newJob') }}
        </NuxtLink>
      </div>

      <!-- ─── Stat cards ─── -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-10">
        <!-- Open Jobs -->
        <NuxtLink
          :to="localePath('/dashboard/jobs')"
          class="group relative rounded-2xl bg-white dark:bg-surface-900 p-5 sm:p-6 no-underline overflow-hidden isolate ring-1 ring-surface-950/[0.04] dark:ring-white/[0.06] hover:ring-brand-500/25 dark:hover:ring-brand-400/25 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-500/[0.08]"
        >
          <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <Briefcase class="absolute -bottom-3 -right-3 size-24 text-brand-500/[0.03] dark:text-brand-400/[0.05] rotate-12 transition-transform duration-700 ease-out group-hover:rotate-3 group-hover:scale-110 pointer-events-none" />
          <div class="relative">
            <div class="flex items-baseline gap-2">
              <span class="text-3xl sm:text-4xl font-black tracking-tight text-surface-900 dark:text-surface-50 tabular-nums leading-none transition-colors duration-300 group-hover:text-brand-600 dark:group-hover:text-brand-400">
                {{ counts.openJobs }}
              </span>
              <span class="size-1.5 rounded-full bg-brand-500 shrink-0 mb-1" />
            </div>
            <span class="block mt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-surface-400 dark:text-surface-500">{{ $t('dashboard.index.openJobs') }}</span>
            <p class="text-[11px] text-surface-300 dark:text-surface-600 mt-1">
              {{ jobsByStatus.draft }} {{ jobsByStatus.draft === 1 ? $t('dashboard.index.draft') : $t('dashboard.index.drafts') }}
            </p>
          </div>
        </NuxtLink>

        <!-- Total Candidates -->
        <NuxtLink
          :to="localePath('/dashboard/candidates')"
          class="group relative rounded-2xl bg-white dark:bg-surface-900 p-5 sm:p-6 no-underline overflow-hidden isolate ring-1 ring-surface-950/[0.04] dark:ring-white/[0.06] hover:ring-violet-500/25 dark:hover:ring-violet-400/25 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-500/[0.08]"
        >
          <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <Users class="absolute -bottom-3 -right-3 size-24 text-violet-500/[0.03] dark:text-violet-400/[0.05] rotate-12 transition-transform duration-700 ease-out group-hover:rotate-3 group-hover:scale-110 pointer-events-none" />
          <div class="relative">
            <div class="flex items-baseline gap-2">
              <span class="text-3xl sm:text-4xl font-black tracking-tight text-surface-900 dark:text-surface-50 tabular-nums leading-none transition-colors duration-300 group-hover:text-violet-600 dark:group-hover:text-violet-400">
                {{ counts.totalCandidates }}
              </span>
              <span class="size-1.5 rounded-full bg-violet-500 shrink-0 mb-1" />
            </div>
            <span class="block mt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-surface-400 dark:text-surface-500">{{ $t('dashboard.index.candidates') }}</span>
            <p class="text-[11px] text-surface-300 dark:text-surface-600 mt-1">{{ $t('dashboard.index.talentPool') }}</p>
          </div>
        </NuxtLink>

        <!-- Total Applications -->
        <NuxtLink
          :to="localePath('/dashboard/applications')"
          class="group relative rounded-2xl bg-white dark:bg-surface-900 p-5 sm:p-6 no-underline overflow-hidden isolate ring-1 ring-surface-950/[0.04] dark:ring-white/[0.06] hover:ring-teal-500/25 dark:hover:ring-teal-400/25 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-teal-500/[0.08]"
        >
          <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <FileText class="absolute -bottom-3 -right-3 size-24 text-teal-500/[0.03] dark:text-teal-400/[0.05] rotate-12 transition-transform duration-700 ease-out group-hover:rotate-3 group-hover:scale-110 pointer-events-none" />
          <div class="relative">
            <div class="flex items-baseline gap-2">
              <span class="text-3xl sm:text-4xl font-black tracking-tight text-surface-900 dark:text-surface-50 tabular-nums leading-none transition-colors duration-300 group-hover:text-teal-600 dark:group-hover:text-teal-400">
                {{ counts.totalApplications }}
              </span>
              <span class="size-1.5 rounded-full bg-teal-500 shrink-0 mb-1" />
            </div>
            <span class="block mt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-surface-400 dark:text-surface-500">{{ $t('dashboard.index.applications') }}</span>
            <p class="text-[11px] text-surface-300 dark:text-surface-600 mt-1">{{ $t('dashboard.index.totalReceived') }}</p>
          </div>
        </NuxtLink>

        <!-- To Review -->
        <NuxtLink
          :to="localePath({ path: '/dashboard/applications', query: { status: 'new' } })"
          class="group relative rounded-2xl bg-white dark:bg-surface-900 p-5 sm:p-6 no-underline overflow-hidden isolate transition-all duration-300 hover:-translate-y-0.5"
          :class="counts.newApplications > 0
            ? 'ring-1 ring-warning-400/30 dark:ring-warning-500/20 hover:ring-warning-500/40 dark:hover:ring-warning-400/30 shadow-sm shadow-warning-500/[0.06] hover:shadow-lg hover:shadow-warning-500/[0.12]'
            : 'ring-1 ring-surface-950/[0.04] dark:ring-white/[0.06] hover:ring-surface-300/50 dark:hover:ring-surface-600/30 hover:shadow-lg hover:shadow-surface-500/[0.04]'"
        >
          <div
            class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent transition-opacity duration-500"
            :class="counts.newApplications > 0
              ? 'via-warning-500 opacity-60 group-hover:opacity-100'
              : 'via-surface-400 opacity-0 group-hover:opacity-40'"
          />
          <AlertCircle class="absolute -bottom-3 -right-3 size-24 rotate-12 transition-transform duration-700 ease-out group-hover:rotate-3 group-hover:scale-110 pointer-events-none" :class="counts.newApplications > 0 ? 'text-warning-500/[0.04] dark:text-warning-400/[0.06]' : 'text-surface-400/[0.03] dark:text-surface-500/[0.05]'" />
          <div class="relative">
            <div class="flex items-baseline gap-2">
              <span
                class="text-3xl sm:text-4xl font-black tracking-tight tabular-nums leading-none transition-colors duration-300"
                :class="counts.newApplications > 0
                  ? 'text-warning-600 dark:text-warning-400 group-hover:text-warning-700 dark:group-hover:text-warning-300'
                  : 'text-surface-900 dark:text-surface-50 group-hover:text-surface-600 dark:group-hover:text-surface-300'"
              >
                {{ counts.newApplications }}
              </span>
              <span class="relative shrink-0 mb-1">
                <span class="size-1.5 rounded-full block" :class="counts.newApplications > 0 ? 'bg-warning-500' : 'bg-surface-300 dark:bg-surface-600'" />
                <span v-if="counts.newApplications > 0" class="absolute inset-0 size-1.5 rounded-full bg-warning-500 animate-ping" />
              </span>
            </div>
            <span class="block mt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-surface-400 dark:text-surface-500">{{ $t('dashboard.index.toReview') }}</span>
            <p class="text-[11px] mt-1" :class="counts.newApplications > 0 ? 'text-warning-500 dark:text-warning-500 font-medium' : 'text-surface-300 dark:text-surface-600'">
              {{ counts.newApplications > 0 ? $t('dashboard.index.needsAttention') : $t('dashboard.index.allReviewed') }}
            </p>
          </div>
        </NuxtLink>
      </div>

      <!-- ─── Main content grid ─── -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- ─── Left column (2/3) ─── -->
        <div class="lg:col-span-2 space-y-6">
          <!-- ─── Pipeline overview (per job) ─── -->
          <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
            <div class="flex items-center justify-between px-6 py-4 border-b border-surface-100 dark:border-surface-800">
              <div class="flex items-center gap-2.5">
                <div class="flex items-center justify-center size-7 rounded-lg bg-surface-100 dark:bg-surface-800">
                  <TrendingUp class="size-3.5 text-surface-500 dark:text-surface-400" />
                </div>
                <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ $t('dashboard.index.hiringPipeline') }}</h2>
              </div>
              <NuxtLink
                :to="localePath('/dashboard/jobs')"
                class="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 no-underline inline-flex items-center gap-1 group/link"
              >
                {{ $t('dashboard.index.allJobs') }}
                <ArrowRight class="size-3 group-hover/link:translate-x-0.5 transition-transform" />
              </NuxtLink>
            </div>

            <div v-if="topJobs.length === 0" class="px-6 py-12 text-center">
              <div class="mx-auto mb-4 flex items-center justify-center size-12 rounded-2xl bg-surface-100 dark:bg-surface-800">
                <Briefcase class="size-5 text-surface-400 dark:text-surface-500" />
              </div>
              <p class="text-sm font-medium text-surface-500 dark:text-surface-400 mb-1">{{ $t('dashboard.index.noOpenJobs') }}</p>
              <p class="text-xs text-surface-400 dark:text-surface-500 mb-4">{{ $t('dashboard.index.noOpenJobsDesc') }}</p>
              <NuxtLink
                :to="localePath('/dashboard/jobs/new')"
                class="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 no-underline hover:text-brand-700 dark:hover:text-brand-300"
              >
                <Plus class="size-3.5" />
                {{ $t('dashboard.index.createOne') }}
              </NuxtLink>
            </div>

            <div v-else class="divide-y divide-surface-100 dark:divide-surface-800">
              <!-- ─── Sprint 20.2: группы по рекрутерам (owner/admin) или плоский список ─── -->
              <template v-for="grp in topJobGroups" :key="grp.key">
                <button
                  v-if="grp.name !== null"
                  class="w-full px-6 py-2.5 flex items-center gap-2 text-left bg-surface-50/70 dark:bg-surface-800/40 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors border-0 cursor-pointer"
                  @click="toggleRecruiterGroup(grp.key)"
                >
                  <ChevronDown
                    class="size-3.5 text-surface-400 transition-transform duration-200"
                    :class="collapsedRecruiters.has(grp.key) ? '-rotate-90' : ''"
                  />
                  <CircleUser class="size-3.5 text-surface-400" />
                  <span class="text-xs font-semibold text-surface-600 dark:text-surface-300">{{ grp.name }}</span>
                  <span class="inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 rounded-full bg-surface-200/70 dark:bg-surface-700 text-[10px] font-medium text-surface-500 dark:text-surface-400 tabular-nums">
                    {{ grp.jobs.length }}
                  </span>
                </button>
                <template v-if="grp.name === null || !collapsedRecruiters.has(grp.key)">
              <div v-for="j in grp.jobs" :key="j.id" class="px-6 py-5 group/job">
                <!-- Job title row -->
                <div class="flex items-center justify-between mb-3">
                  <NuxtLink
                    :to="localePath(`/dashboard/jobs/${j.id}`)"
                    class="text-sm font-semibold text-surface-900 dark:text-surface-100 hover:text-brand-600 dark:hover:text-brand-400 transition-colors no-underline truncate"
                  >
                    {{ j.title }}
                  </NuxtLink>
                  <!-- Спринт 11.4: итоговое значение включает все отказы -->
                  <span
                    class="text-xs text-surface-400 dark:text-surface-500 shrink-0 ml-3 tabular-nums font-medium"
                    :title="jobHasStages(j) ? `В работе: ${jobWorkingTotal(j)} · Отказы: ${jobRejectedTotal(j)}` : undefined"
                  >
                    {{ jobHasStages(j) ? jobGrandTotal(j) : j.applicationCount }} {{ $t('dashboard.index.total') }}
                  </span>
                </div>

                <!-- ─── Sprint 10 / Фаза 1: воронка всегда по реальным этапам пайплайна ─── -->
                <template v-if="jobHasStages(j)">
                  <!-- Pipeline bar (динамические этапы) -->
                  <div v-if="jobGrandTotal(j) > 0" class="mb-3.5">
                    <div class="flex h-1.5 rounded-full overflow-hidden bg-surface-100 dark:bg-surface-800">
                      <div
                        v-for="stage in jobWorkingStages(j).filter(s => s.count > 0)"
                        :key="stage.id"
                        class="transition-all duration-500"
                        :style="{ width: `${(stage.count / jobGrandTotal(j)) * 100}%`, backgroundColor: stage.color || '#94a3b8' }"
                      />
                      <div
                        v-if="jobRejectedTotal(j) > 0"
                        class="transition-all duration-500 bg-surface-300 dark:bg-surface-600"
                        :style="{ width: `${(jobRejectedTotal(j) / jobGrandTotal(j)) * 100}%` }"
                      />
                    </div>
                  </div>

                  <!-- Stage counts (динамические этапы) -->
                  <div class="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                    <NuxtLink
                      v-for="stage in jobWorkingStages(j)"
                      :key="stage.id"
                      :to="localePath(`/dashboard/jobs/${j.id}?stage=${stage.id}`)"
                      class="rounded-lg px-2 py-1.5 text-center transition-all duration-150 no-underline bg-surface-50 dark:bg-surface-800/60 hover:ring-1 hover:ring-brand-300/50 dark:hover:ring-brand-700/50 hover:shadow-sm"
                      :class="stage.count > 0 ? 'cursor-pointer' : 'opacity-50'"
                      :title="stage.name"
                    >
                      <div class="text-sm font-bold tabular-nums" :style="{ color: stage.color || undefined }">
                        {{ stage.count }}
                      </div>
                      <div class="text-[10px] font-medium text-surface-500 dark:text-surface-400 leading-tight truncate">
                        {{ stage.name }}
                      </div>
                    </NuxtLink>
                    <div
                      class="rounded-lg px-2 py-1.5 text-center bg-surface-100 dark:bg-surface-800"
                      :class="jobRejectedTotal(j) > 0 ? '' : 'opacity-50'"
                      :title="$t('dashboard.jobs.pipeline.stages.rejected')"
                    >
                      <div class="text-sm font-bold tabular-nums text-surface-500 dark:text-surface-400">
                        {{ jobRejectedTotal(j) }}
                      </div>
                      <div class="text-[10px] font-medium text-surface-500 dark:text-surface-400 leading-tight truncate">
                        {{ $t('dashboard.jobs.pipeline.stages.rejected') }}
                      </div>
                    </div>
                  </div>
                </template>

              </div>
                </template>
              </template>
            </div>
          </div>

          <!-- ─── Recent applications ─── -->
          <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
            <div class="flex items-center justify-between px-6 py-4 border-b border-surface-100 dark:border-surface-800">
              <div class="flex items-center gap-2.5">
                <div class="flex items-center justify-center size-7 rounded-lg bg-surface-100 dark:bg-surface-800">
                  <Clock class="size-3.5 text-surface-500 dark:text-surface-400" />
                </div>
                <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ $t('dashboard.index.recentApplications') }}</h2>
              </div>
              <NuxtLink
                :to="localePath('/dashboard/applications')"
                class="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 no-underline inline-flex items-center gap-1 group/link"
              >
                {{ $t('dashboard.index.viewAll') }}
                <ArrowRight class="size-3 group-hover/link:translate-x-0.5 transition-transform" />
              </NuxtLink>
            </div>

            <div v-if="recentApplications.length === 0" class="px-6 py-12 text-center">
              <div class="mx-auto mb-4 flex items-center justify-center size-12 rounded-2xl bg-surface-100 dark:bg-surface-800">
                <FileText class="size-5 text-surface-400 dark:text-surface-500" />
              </div>
              <p class="text-sm font-medium text-surface-500 dark:text-surface-400">{{ $t('dashboard.index.noApplicationsYet') }}</p>
            </div>

            <div v-else class="divide-y divide-surface-100 dark:divide-surface-800">
              <NuxtLink
                v-for="app in recentApplications"
                :key="app.id"
                :to="localePath(`/dashboard/applications/${app.id}`)"
                class="flex items-center gap-4 px-6 py-3.5 hover:bg-surface-50 dark:hover:bg-surface-800/40 transition-colors no-underline group"
              >
                <!-- Avatar -->
                <div class="flex items-center justify-center size-9 rounded-full bg-gradient-to-br from-brand-100 to-brand-200 dark:from-brand-900/80 dark:to-brand-800/80 shrink-0 ring-1 ring-brand-200/50 dark:ring-brand-800/50">
                  <span class="text-xs font-bold text-brand-700 dark:text-brand-300">
                    {{ ((app.candidateFirstName?.[0] ?? '') + (app.candidateLastName?.[0] ?? '')).toUpperCase() }}
                  </span>
                </div>

                <!-- Info -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 mb-0.5">
                    <span class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                      {{ formatPersonName(app.candidateFirstName, app.candidateLastName) }}
                    </span>
                    <!-- Фаза 1: бейдж — реальный этап воронки вместо легаси-статуса -->
                    <span
                      v-if="(app as any).currentStageName"
                      class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 whitespace-nowrap shrink-0"
                    >
                      <span class="inline-flex size-1.5 rounded-full shrink-0" :style="{ backgroundColor: (app as any).currentStageColor || '#9ca3af' }" />
                      {{ (app as any).currentStageName }}
                    </span>
                    <span
                      v-else
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-surface-100 dark:bg-surface-800 text-surface-400 dark:text-surface-500 whitespace-nowrap shrink-0"
                    >{{ $t('dashboard.index.noStage') }}</span>
                  </div>
                  <div class="text-xs text-surface-400 dark:text-surface-500 truncate">
                    {{ app.jobTitle }}
                  </div>
                </div>

                <!-- Time -->
                <span class="text-[11px] text-surface-400 dark:text-surface-500 shrink-0 tabular-nums font-medium">
                  {{ formatDate(app.createdAt) }}
                </span>
              </NuxtLink>
            </div>
          </div>
        </div>

        <!-- ─── Right column (1/3) ─── -->
        <div class="space-y-6">
          <!-- ─── Achievements widget ─── -->
          <RankWidget />
          <QuestsWidget />
          <HuntPassWidget />
          <AchievementsWidget />
          <!-- ─── Upcoming interviews ─── -->
          <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
            <div class="flex items-center justify-between px-5 py-4 border-b border-surface-100 dark:border-surface-800">
              <div class="flex items-center gap-2.5">
                <div class="flex items-center justify-center size-7 rounded-lg bg-surface-100 dark:bg-surface-800">
                  <Calendar class="size-3.5 text-surface-500 dark:text-surface-400" />
                </div>
                <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ $t('dashboard.index.upcomingInterviews') }}</h2>
              </div>
              <NuxtLink
                :to="localePath('/dashboard/interviews')"
                class="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 no-underline inline-flex items-center gap-1 group/link"
              >
                Все
                <ArrowRight class="size-3 group-hover/link:translate-x-0.5 transition-transform" />
              </NuxtLink>
            </div>

            <div v-if="upcomingInterviews.length === 0" class="px-5 py-10 text-center">
              <div class="mx-auto mb-4 flex items-center justify-center size-12 rounded-2xl bg-surface-100 dark:bg-surface-800">
                <Calendar class="size-5 text-surface-400 dark:text-surface-500" />
              </div>
              <p class="text-sm font-medium text-surface-500 dark:text-surface-400 mb-0.5">{{ $t('dashboard.index.noUpcomingInterviews') }}</p>
              <p class="text-xs text-surface-400 dark:text-surface-500">{{ $t('dashboard.index.next7Days') }}</p>
            </div>

            <div v-else class="divide-y divide-surface-100 dark:divide-surface-800">
              <NuxtLink
                v-for="interview in upcomingInterviews"
                :key="interview.id"
                :to="localePath(`/dashboard/interviews/${interview.id}`)"
                class="block px-5 py-3.5 hover:bg-surface-50 dark:hover:bg-surface-800/40 transition-colors no-underline group"
              >
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                    {{ formatPersonName(interview.candidateFirstName, interview.candidateLastName) }}
                  </span>
                  <span class="inline-flex items-center rounded-full bg-brand-50 dark:bg-brand-950/40 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:text-brand-400 shrink-0 ml-2">
                    {{ formatRelativeDate(interview.scheduledAt) }}
                  </span>
                </div>
                <div class="flex items-center gap-2 text-xs text-surface-400 dark:text-surface-500">
                  <span class="font-medium">{{ formatTime(interview.scheduledAt) }}</span>
                  <span class="text-surface-200 dark:text-surface-700">·</span>
                  <span>{{ interviewTypeLabels[interview.type] ?? interview.type }}</span>
                  <span class="text-surface-200 dark:text-surface-700">·</span>
                  <span class="truncate">{{ interview.jobTitle }}</span>
                  <a
                    v-if="interview.googleCalendarEventLink"
                    :href="interview.googleCalendarEventLink"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors shrink-0 ml-auto"
                    @click.stop
                  >
                    <Calendar class="size-2.5" />
                    Google Calendar
                    <ExternalLink class="size-2" />
                  </a>
                </div>
              </NuxtLink>
            </div>
          </div>

          <!-- ─── Quick actions ─── -->
          <div class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
            <div class="flex items-center gap-2.5 px-5 py-4 border-b border-surface-100 dark:border-surface-800">
              <div class="flex items-center justify-center size-7 rounded-lg bg-surface-100 dark:bg-surface-800">
                <Zap class="size-3.5 text-surface-500 dark:text-surface-400" />
              </div>
              <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ $t('dashboard.index.quickActions') }}</h2>
            </div>

            <div class="p-2.5 space-y-0.5">
              <NuxtLink
                :to="localePath('/dashboard/jobs/new')"
                class="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 hover:text-brand-700 dark:hover:text-brand-300 transition-all no-underline group/action"
              >
                <div class="flex items-center justify-center size-8 rounded-lg bg-brand-50 dark:bg-brand-950/40 group-hover/action:bg-brand-100 dark:group-hover/action:bg-brand-950/60 transition-colors">
                  <Plus class="size-4 text-brand-600 dark:text-brand-400" />
                </div>
                {{ $t('dashboard.index.createNewJob') }}
              </NuxtLink>
              <NuxtLink
                :to="localePath('/dashboard/candidates/new')"
                class="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-violet-50 dark:hover:bg-violet-950/30 hover:text-violet-700 dark:hover:text-violet-300 transition-all no-underline group/action"
              >
                <div class="flex items-center justify-center size-8 rounded-lg bg-violet-50 dark:bg-violet-950/40 group-hover/action:bg-violet-100 dark:group-hover/action:bg-violet-950/60 transition-colors">
                  <UserPlus class="size-4 text-violet-600 dark:text-violet-400" />
                </div>
                {{ $t('dashboard.index.addCandidate') }}
              </NuxtLink>
              <NuxtLink
                :to="localePath('/dashboard/applications')"
                class="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-teal-50 dark:hover:bg-teal-950/30 hover:text-teal-700 dark:hover:text-teal-300 transition-all no-underline group/action"
              >
                <div class="flex items-center justify-center size-8 rounded-lg bg-teal-50 dark:bg-teal-950/40 group-hover/action:bg-teal-100 dark:group-hover/action:bg-teal-950/60 transition-colors">
                  <Eye class="size-4 text-teal-600 dark:text-teal-400" />
                </div>
                {{ $t('dashboard.index.reviewApplications') }}
              </NuxtLink>
              <NuxtLink
                :to="localePath('/dashboard/interviews')"
                class="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:text-amber-700 dark:hover:text-amber-300 transition-all no-underline group/action"
              >
                <div class="flex items-center justify-center size-8 rounded-lg bg-amber-50 dark:bg-amber-950/40 group-hover/action:bg-amber-100 dark:group-hover/action:bg-amber-950/60 transition-colors">
                  <Calendar class="size-4 text-amber-600 dark:text-amber-400" />
                </div>
                {{ $t('dashboard.index.viewInterviews') }}
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
