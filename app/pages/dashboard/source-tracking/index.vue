<script setup lang="ts">
import {
  Link2, Users, Plus, AlertCircle,
  CheckCircle2, XCircle,
  Copy, ToggleLeft, ToggleRight,
  Trash2, ChevronDown, ChevronUp, X,
} from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Отслеживание источников',
  description: 'Отслеживайте источники откликов',
})

const localePath = useLocalePath()
const { track } = useTrack()
const toast = useToast()
const { formatPersonName } = useOrgSettings()

onMounted(() => track('source_tracking_viewed'))

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────

const route = useRoute()

// Initialize filters from query params (e.g. ?jobId=xxx&tab=links)
const selectedJobId = ref<string | undefined>(route.query.jobId as string | undefined)
const selectedChannel = ref<string | undefined>()
const dateRange = ref<'7d' | '30d' | '90d' | 'all'>('30d')

const dateFrom = computed(() => {
  if (dateRange.value === 'all') return undefined
  const d = new Date()
  const days = { '7d': 7, '30d': 30, '90d': 90 }[dateRange.value]
  d.setDate(d.getDate() - days)
  return d.toISOString()
})

// ─────────────────────────────────────────────
// Fetch data
// ─────────────────────────────────────────────

const {
  recentAttributed,
  statsStatus,
  statsError,
  refreshStats,
} = useSourceTracking({
  jobId: selectedJobId,
  from: dateFrom,
})

const {
  links,
  total: totalLinks,
  fetchStatus: linksStatus,
  createLink,
  updateLink,
  deleteLink,
  toggleLink,
  refresh: refreshLinks,
} = useTrackingLinks()

// Fetch jobs for filter dropdown
const { data: jobsData } = useFetch('/api/jobs', {
  key: 'source-tracking-jobs',
  headers: useRequestHeaders(['cookie']),
  query: { limit: 100 },
})
const jobs = computed(() => (jobsData.value as any)?.data ?? [])

const { allowed: canManageLinks } = usePermission({ sourceTracking: ['create'] })

// ─────────────────────────────────────────────
// Create link modal
// ─────────────────────────────────────────────

const showCreateModal = ref(false)
const isCreating = ref(false)
const newLink = ref({
  name: '',
  channel: 'custom' as string,
  jobId: '' as string,
  utmSource: '',
  utmMedium: '',
  utmCampaign: '',
})

async function handleCreateLink() {
  if (!newLink.value.name.trim()) return
  isCreating.value = true
  try {
    await createLink({
      name: newLink.value.name.trim(),
      channel: newLink.value.channel as any,
      jobId: newLink.value.jobId || undefined,
      utmSource: newLink.value.utmSource || undefined,
      utmMedium: newLink.value.utmMedium || undefined,
      utmCampaign: newLink.value.utmCampaign || undefined,
    })
    showCreateModal.value = false
    newLink.value = { name: '', channel: 'custom', jobId: '', utmSource: '', utmMedium: '', utmCampaign: '' }
    await refreshStats()
  } catch (err: any) {
    toast.error(err?.data?.statusMessage ?? 'Не удалось создать ссылку')
  } finally {
    isCreating.value = false
  }
}

// ─────────────────────────────────────────────
// Delete confirmation
// ─────────────────────────────────────────────

const deletingId = ref<string | null>(null)
const showDeleteConfirm = ref(false)

function confirmDelete(id: string) {
  deletingId.value = id
  showDeleteConfirm.value = true
}

async function handleDelete() {
  if (!deletingId.value) return
  try {
    await deleteLink(deletingId.value)
    await refreshStats()
  } catch (err: any) {
    toast.error(err?.data?.statusMessage ?? 'Не удалось удалить')
  } finally {
    showDeleteConfirm.value = false
    deletingId.value = null
  }
}

// ─────────────────────────────────────────────
// Link URL builder
// ─────────────────────────────────────────────

const requestUrl = useRequestURL()
function buildTrackingUrl(code: string): string {
  const base = `${requestUrl.protocol}//${requestUrl.host}`
  return `${base}/api/public/track/${encodeURIComponent(code)}`
}

const copiedCode = ref<string | null>(null)
async function copyTrackingUrl(code: string) {
  try {
    await navigator.clipboard.writeText(buildTrackingUrl(code))
    copiedCode.value = code
    setTimeout(() => { copiedCode.value = null }, 2000)
  } catch {
    toast.info(buildTrackingUrl(code))
  }
}

// ─────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────

const channelLabels: Record<string, string> = {
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  glassdoor: 'Glassdoor',
  ziprecruiter: 'ZipRecruiter',
  monster: 'Monster',
  handshake: 'Handshake',
  angellist: 'AngelList',
  wellfound: 'Wellfound',
  dice: 'Dice',
  stackoverflow: 'Stack Overflow',
  weworkremotely: 'We Work Remotely',
  remoteok: 'Remote OK',
  builtin: 'Built In',
  hired: 'Hired',
  lever: 'Lever',
  greenhouse_board: 'Greenhouse',
  google_jobs: 'Google Jobs',
  facebook: 'Facebook',
  twitter: 'X / Twitter',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  reddit: 'Reddit',
  referral: 'Рекомендация',
  career_site: 'Карьерный сайт',
  email: 'Email',
  event: 'Мероприятие',
  agency: 'Агентство',
  direct: 'Прямой переход',
  other: 'Другое',
  custom: 'Свой',
}

const channelColors: Record<string, string> = {
  linkedin: 'bg-blue-500',
  indeed: 'bg-indigo-500',
  glassdoor: 'bg-emerald-500',
  ziprecruiter: 'bg-green-600',
  monster: 'bg-violet-500',
  google_jobs: 'bg-red-500',
  facebook: 'bg-blue-600',
  twitter: 'bg-surface-700 dark:bg-surface-300',
  instagram: 'bg-pink-500',
  tiktok: 'bg-surface-900 dark:bg-surface-100',
  reddit: 'bg-orange-500',
  referral: 'bg-amber-500',
  career_site: 'bg-brand-500',
  email: 'bg-teal-500',
  direct: 'bg-surface-400',
  other: 'bg-surface-300 dark:bg-surface-600',
  custom: 'bg-brand-400',
  event: 'bg-cyan-500',
  agency: 'bg-rose-500',
}

const channelBadgeClasses: Record<string, string> = {
  linkedin: 'bg-blue-50 text-blue-700 ring-blue-200/60 dark:bg-blue-950 dark:text-blue-400 dark:ring-blue-800/40',
  indeed: 'bg-indigo-50 text-indigo-700 ring-indigo-200/60 dark:bg-indigo-950 dark:text-indigo-400 dark:ring-indigo-800/40',
  glassdoor: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-950 dark:text-emerald-400 dark:ring-emerald-800/40',
  referral: 'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-950 dark:text-amber-400 dark:ring-amber-800/40',
  direct: 'bg-surface-100 text-surface-600 ring-surface-200 dark:bg-surface-800 dark:text-surface-400 dark:ring-surface-700',
  career_site: 'bg-brand-50 text-brand-700 ring-brand-200/60 dark:bg-brand-950 dark:text-brand-400 dark:ring-brand-800/40',
  email: 'bg-teal-50 text-teal-700 ring-teal-200/60 dark:bg-teal-950 dark:text-teal-400 dark:ring-teal-800/40',
}

function getChannelBadge(channel: string) {
  return channelBadgeClasses[channel] ?? 'bg-surface-100 text-surface-600 ring-surface-200 dark:bg-surface-800 dark:text-surface-400 dark:ring-surface-700'
}

function getChannelColor(channel: string) {
  return channelColors[channel] ?? 'bg-surface-400 dark:bg-surface-500'
}

function getChannelLabel(channel: string) {
  return channelLabels[channel] ?? channel
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Только что'
  if (diffMins < 60) return `${diffMins} мин назад`
  if (diffHours < 24) return `${diffHours} ч назад`
  if (diffDays < 7) return `${diffDays} дн. назад`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const filteredAttributed = computed(() => {
  if (!selectedChannel.value) return recentAttributed.value
  return recentAttributed.value.filter(a => a.channel === selectedChannel.value)
})

// ─────────────────────────────────────────────
// Tracking links table sorting
// ─────────────────────────────────────────────

type LinkSortKey = 'name' | 'channel' | 'clickCount' | 'applicationCount' | 'cvr' | 'isActive'
const linkSortKey = ref<LinkSortKey>('clickCount')
const linkSortAsc = ref(false)

function toggleLinkSort(key: LinkSortKey) {
  if (linkSortKey.value === key) {
    linkSortAsc.value = !linkSortAsc.value
  } else {
    linkSortKey.value = key
    linkSortAsc.value = key === 'name' || key === 'channel' // default asc for text columns
  }
}

function getLinkCvr(link: { clickCount: number; applicationCount: number }) {
  return link.clickCount > 0 ? link.applicationCount / link.clickCount : 0
}

const sortedLinks = computed(() => {
  const sorted = [...links.value].sort((a, b) => {
    let cmp = 0
    switch (linkSortKey.value) {
      case 'name':
        cmp = a.name.localeCompare(b.name)
        break
      case 'channel':
        cmp = a.channel.localeCompare(b.channel)
        break
      case 'clickCount':
        cmp = a.clickCount - b.clickCount
        break
      case 'applicationCount':
        cmp = a.applicationCount - b.applicationCount
        break
      case 'cvr':
        cmp = getLinkCvr(a) - getLinkCvr(b)
        break
      case 'isActive':
        cmp = Number(a.isActive) - Number(b.isActive)
        break
    }
    return linkSortAsc.value ? cmp : -cmp
  })
  return sorted
})

const initialTab = (['links', 'table'] as const).includes(route.query.tab as any)
  ? (route.query.tab as 'links' | 'table')
  : 'links'
const showTab = ref<'links' | 'table'>(initialTab)
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <!-- ─── Loading skeleton ─── -->
    <div v-if="statsStatus === 'pending'">
      <div class="mb-10">
        <div class="h-8 w-56 bg-surface-200 dark:bg-surface-700 rounded-lg animate-pulse mb-2" />
        <div class="h-4 w-72 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
      </div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <div v-for="i in 4" :key="i" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 animate-pulse">
          <div class="h-4 w-20 bg-surface-200 dark:bg-surface-700 rounded mb-4" />
          <div class="h-9 w-14 bg-surface-200 dark:bg-surface-700 rounded" />
        </div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 animate-pulse">
          <div class="h-5 w-32 bg-surface-200 dark:bg-surface-700 rounded mb-6" />
          <div class="space-y-4">
            <div v-for="i in 5" :key="i" class="h-10 bg-surface-100 dark:bg-surface-800 rounded-xl" />
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
      v-else-if="statsError"
      class="rounded-2xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/60 p-5 text-sm text-danger-700 dark:text-danger-400 flex items-center gap-3"
    >
      <AlertCircle class="size-5 shrink-0" />
      <span>Не удалось загрузить данные отслеживания источников.</span>
      <UiButton variant="link" class="ml-auto" @click="refreshStats()">Повторить</UiButton>
    </div>

    <!-- ─── Main content ─── -->
    <template v-else>
      <!-- ─── Header ─── -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-10">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">Отслеживаемые ссылки</h1>
          <p class="text-sm text-surface-400 dark:text-surface-500 mt-1">
            Управление трекинг-ссылками. Полная аналитика источников —
            <NuxtLink :to="localePath('/dashboard/analytics/sources')" class="text-primary-600 dark:text-primary-400 hover:underline">в Центре аналитики →</NuxtLink>
          </p>
        </div>
        <div class="flex items-center gap-2">
          <!-- Date range pill -->
          <UiSegmented
            v-model="dateRange"
            aria-label="Период"
            :options="[
              { value: '7d', label: '7D' },
              { value: '30d', label: '30D' },
              { value: '90d', label: '90D' },
              { value: 'all', label: 'За всё время' },
            ]"
          />

          <!-- Job filter -->
          <div class="relative">
            <select
              v-model="selectedJobId"
              class="appearance-none rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 pl-3 pr-8 py-2 text-xs font-medium text-surface-700 dark:text-surface-300 cursor-pointer"
            >
              <option :value="undefined">Все вакансии</option>
              <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }}</option>
            </select>
            <ChevronDown class="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-surface-400 pointer-events-none" />
          </div>

          <!-- Create link button -->
          <UiButton
            v-if="canManageLinks"
            variant="primary"
            size="sm"
            :icon-left="Plus"
            @click="showCreateModal = true"
          >
            <span class="hidden sm:inline">Новая ссылка</span>
          </UiButton>
        </div>
      </div>

      <!-- ─── Tab navigation ─── -->
      <div class="flex items-center gap-1 mb-6 border-b border-surface-200 dark:border-surface-800">
        <button
          v-for="tab in [
            { key: 'links', label: 'Ссылки отслеживания', icon: Link2 },
            { key: 'table', label: 'Журнал атрибуции', icon: Users },
          ] as const"
          :key="tab.key"
          class="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors"
          :class="showTab === tab.key
            ? 'border-brand-600 text-brand-600 dark:text-brand-400 dark:border-brand-400'
            : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'"
          @click="showTab = tab.key; if (tab.key !== 'table') selectedChannel = undefined"
        >
          <component :is="tab.icon" class="size-4" />
          {{ tab.label }}
          <span
            v-if="tab.key === 'links'"
            class="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold tabular-nums"
            :class="showTab === 'links'
              ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-400'
              : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'"
          >
            {{ totalLinks }}
          </span>
        </button>
      </div>

      <!-- Аналитика источников перенесена в Центр аналитики (/dashboard/analytics/sources).
           Эта страница — управление ссылками (links) + журнал атрибуции (table). -->

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB: Tracking Links                     -->
      <!-- ═══════════════════════════════════════ -->
      <div v-if="showTab === 'links'">
        <div v-if="links.length === 0" class="flex flex-col items-center justify-center py-20">
          <div class="rounded-3xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-14 text-center max-w-md shadow-sm">
            <div class="mx-auto mb-8 flex items-center justify-center size-18 rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 shadow-lg shadow-brand-500/20">
              <Link2 class="size-9 text-white" />
            </div>
            <h2 class="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-3 tracking-tight">
              Создать первую ссылку
            </h2>
            <p class="text-sm text-surface-500 dark:text-surface-400 mb-10 leading-relaxed max-w-sm mx-auto">
              Создавайте уникальные ссылки для каждого джоб-борда, кампании или источника рекомендаций. Отслеживайте переходы, отклики и конверсии в реальном времени.
            </p>
            <UiButton
              v-if="canManageLinks"
              size="lg"
              :icon-left="Plus"
              @click="showCreateModal = true"
            >
              Создать ссылку
            </UiButton>
          </div>
        </div>

        <div v-else class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-surface-100 dark:border-surface-800 bg-surface-50/50 dark:bg-surface-800/30">
                  <th class="px-5 py-3 text-left text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" @click="toggleLinkSort('name')">
                    <span class="inline-flex items-center gap-1">Название <component :is="linkSortKey === 'name' ? (linkSortAsc ? ChevronUp : ChevronDown) : ChevronDown" class="size-3" :class="linkSortKey === 'name' ? 'opacity-100' : 'opacity-0'" /></span>
                  </th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" @click="toggleLinkSort('channel')">
                    <span class="inline-flex items-center gap-1">Источник <component :is="linkSortKey === 'channel' ? (linkSortAsc ? ChevronUp : ChevronDown) : ChevronDown" class="size-3" :class="linkSortKey === 'channel' ? 'opacity-100' : 'opacity-0'" /></span>
                  </th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Вакансия</th>
                  <th class="px-4 py-3 text-center text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" @click="toggleLinkSort('clickCount')">
                    <span class="inline-flex items-center gap-1">Переходы <component :is="linkSortKey === 'clickCount' ? (linkSortAsc ? ChevronUp : ChevronDown) : ChevronDown" class="size-3" :class="linkSortKey === 'clickCount' ? 'opacity-100' : 'opacity-0'" /></span>
                  </th>
                  <th class="px-4 py-3 text-center text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" @click="toggleLinkSort('applicationCount')">
                    <span class="inline-flex items-center gap-1">Отклики <component :is="linkSortKey === 'applicationCount' ? (linkSortAsc ? ChevronUp : ChevronDown) : ChevronDown" class="size-3" :class="linkSortKey === 'applicationCount' ? 'opacity-100' : 'opacity-0'" /></span>
                  </th>
                  <th class="px-4 py-3 text-center text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" @click="toggleLinkSort('cvr')">
                    <span class="inline-flex items-center gap-1">Конверсия <component :is="linkSortKey === 'cvr' ? (linkSortAsc ? ChevronUp : ChevronDown) : ChevronDown" class="size-3" :class="linkSortKey === 'cvr' ? 'opacity-100' : 'opacity-0'" /></span>
                  </th>
                  <th class="px-4 py-3 text-center text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" @click="toggleLinkSort('isActive')">
                    <span class="inline-flex items-center gap-1">Статус <component :is="linkSortKey === 'isActive' ? (linkSortAsc ? ChevronUp : ChevronDown) : ChevronDown" class="size-3" :class="linkSortKey === 'isActive' ? 'opacity-100' : 'opacity-0'" /></span>
                  </th>
                  <th class="px-4 py-3 text-right text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Действия</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
                <tr v-for="link in sortedLinks" :key="link.id" class="hover:bg-surface-50 dark:hover:bg-surface-800/40 transition-colors group">
                  <!-- Name + URL -->
                  <td class="px-5 py-3.5">
                    <NuxtLink
                      :to="localePath(`/dashboard/source-tracking/${link.id}`)"
                      class="font-medium text-surface-800 dark:text-surface-200 mb-0.5 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                    >
                      {{ link.name }}
                    </NuxtLink>
                    <div class="text-[11px] text-surface-400 dark:text-surface-500 font-mono truncate max-w-[200px]">
                      ?ref={{ link.code }}
                    </div>
                  </td>
                  <!-- Channel -->
                  <td class="px-4 py-3.5">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset"
                      :class="getChannelBadge(link.channel)"
                    >
                      {{ getChannelLabel(link.channel) }}
                    </span>
                  </td>
                  <!-- Job -->
                  <td class="px-4 py-3.5 text-surface-600 dark:text-surface-300 truncate max-w-[150px]">
                    {{ link.jobTitle ?? 'Все вакансии' }}
                  </td>
                  <!-- Clicks -->
                  <td class="px-4 py-3.5 text-center tabular-nums font-medium text-surface-700 dark:text-surface-200">
                    {{ link.clickCount }}
                  </td>
                  <!-- Applications -->
                  <td class="px-4 py-3.5 text-center tabular-nums font-medium text-surface-700 dark:text-surface-200">
                    {{ link.applicationCount }}
                  </td>
                  <!-- CVR -->
                  <td class="px-4 py-3.5 text-center">
                    <span class="tabular-nums font-bold" :class="link.clickCount > 0 && link.applicationCount > 0 ? 'text-green-600 dark:text-green-400' : 'text-surface-400'">
                      {{ link.clickCount > 0 ? `${Math.round((link.applicationCount / link.clickCount) * 100)}%` : '—' }}
                    </span>
                  </td>
                  <!-- Status -->
                  <td class="px-4 py-3.5 text-center">
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset"
                      :class="link.isActive
                        ? 'bg-green-50 text-green-700 ring-green-200/60 dark:bg-green-950 dark:text-green-400 dark:ring-green-800/40'
                        : 'bg-surface-100 text-surface-500 ring-surface-200 dark:bg-surface-800 dark:text-surface-400 dark:ring-surface-700'"
                    >
                      <CheckCircle2 v-if="link.isActive" class="size-3" />
                      <XCircle v-else class="size-3" />
                      {{ link.isActive ? 'Активная' : 'Неактивная' }}
                    </span>
                  </td>
                  <!-- Actions -->
                  <td class="px-4 py-3.5 text-right">
                    <div class="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <UiButton
                        variant="ghost"
                        icon-only
                        size="sm"
                        title="Копировать URL отслеживания"
                        class="text-surface-400 hover:text-brand-600 dark:hover:text-brand-400"
                        @click="copyTrackingUrl(link.code)"
                      >
                        <Copy v-if="copiedCode !== link.code" class="size-3.5" />
                        <CheckCircle2 v-else class="size-3.5 text-green-500" />
                      </UiButton>
                      <UiButton
                        v-if="canManageLinks"
                        variant="ghost"
                        icon-only
                        size="sm"
                        :title="link.isActive ? 'Отключить' : 'Включить'"
                        class="text-surface-400 hover:text-amber-600 dark:hover:text-amber-400"
                        @click="toggleLink(link.id, !link.isActive)"
                      >
                        <ToggleRight v-if="link.isActive" class="size-3.5" />
                        <ToggleLeft v-else class="size-3.5" />
                      </UiButton>
                      <UiButton
                        v-if="canManageLinks"
                        variant="ghost"
                        icon-only
                        size="sm"
                        title="Удалить"
                        class="text-surface-400 hover:text-danger-600 dark:hover:text-danger-400"
                        @click="confirmDelete(link.id)"
                      >
                        <Trash2 class="size-3.5" />
                      </UiButton>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB: Attribution Log                    -->
      <!-- ═══════════════════════════════════════ -->
      <div v-if="showTab === 'table'">
        <!-- Channel filter chip -->
        <div v-if="selectedChannel" class="mb-4 flex items-center gap-2">
          <span class="text-xs text-surface-500 dark:text-surface-400">Фильтр:</span>
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset"
            :class="getChannelBadge(selectedChannel)"
          >
            <span class="size-1.5 rounded-full" :class="getChannelColor(selectedChannel)" />
            {{ getChannelLabel(selectedChannel) }}
            <UiButton variant="ghost" icon-only size="xs" class="ml-0.5 hover:text-surface-900 dark:hover:text-surface-100" @click="selectedChannel = undefined">
              <X class="size-3" />
            </UiButton>
          </span>
        </div>

        <div v-if="filteredAttributed.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
          <div class="mx-auto mb-4 flex items-center justify-center size-14 rounded-2xl bg-surface-100 dark:bg-surface-800">
            <Users class="size-6 text-surface-400 dark:text-surface-500" />
          </div>
          <p class="text-sm font-medium text-surface-500 dark:text-surface-400 mb-1">Нет откликов с атрибуцией</p>
          <p class="text-xs text-surface-400 dark:text-surface-500 max-w-sm">
            Начните делиться ссылками отслеживания, чтобы увидеть данные об источниках.
          </p>
        </div>

        <div v-else class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-surface-100 dark:border-surface-800 bg-surface-50/50 dark:bg-surface-800/30">
                  <th class="px-5 py-3 text-left text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Кандидат</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Вакансия</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Источник</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Кампания</th>
                  <th class="px-4 py-3 text-center text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Статус</th>
                  <th class="px-4 py-3 text-right text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Откликнулся</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
                <tr v-for="app in filteredAttributed" :key="app.applicationId" class="hover:bg-surface-50 dark:hover:bg-surface-800/40 transition-colors">
                  <!-- Candidate -->
                  <td class="px-5 py-3.5">
                    <NuxtLink
                      :to="localePath({ path: `/dashboard/jobs/${app.jobId}`, query: app.currentStageId ? { stage: app.currentStageId } : {} })"
                      class="flex items-center gap-2.5 group/candidate"
                    >
                      <div class="flex items-center justify-center size-8 rounded-full bg-gradient-to-br from-brand-100 to-brand-200 dark:from-brand-900/80 dark:to-brand-800/80 shrink-0 ring-1 ring-brand-200/50 dark:ring-brand-800/50">
                        <span class="text-[10px] font-bold text-brand-700 dark:text-brand-300">
                          {{ ((app.candidateFirstName?.[0] ?? '') + (app.candidateLastName?.[0] ?? '')).toUpperCase() }}
                        </span>
                      </div>
                      <div class="min-w-0">
                        <div class="text-sm font-medium text-surface-800 dark:text-surface-200 truncate group-hover/candidate:text-brand-600 dark:group-hover/candidate:text-brand-400 transition-colors">
                          {{ formatPersonName(app.candidateFirstName, app.candidateLastName) }}
                        </div>
                        <div class="text-[11px] text-surface-400 truncate">{{ app.candidateEmail }}</div>
                      </div>
                    </NuxtLink>
                  </td>
                  <!-- Job -->
                  <td class="px-4 py-3.5 text-surface-600 dark:text-surface-300 truncate max-w-[150px]">
                    {{ app.jobTitle }}
                  </td>
                  <!-- Source channel -->
                  <td class="px-4 py-3.5">
                    <div class="flex items-center gap-2">
                      <span
                        class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset"
                        :class="getChannelBadge(app.channel)"
                      >
                        {{ getChannelLabel(app.channel) }}
                      </span>
                    </div>
                    <div v-if="app.trackingLinkName" class="text-[11px] text-surface-400 mt-0.5 truncate max-w-[140px]">
                      via {{ app.trackingLinkName }}
                    </div>
                    <div v-else-if="app.referrerDomain" class="text-[11px] text-surface-400 mt-0.5 truncate max-w-[140px]">
                      {{ app.referrerDomain }}
                    </div>
                  </td>
                  <!-- Campaign -->
                  <td class="px-4 py-3.5 text-xs text-surface-500 dark:text-surface-400 truncate max-w-[120px]">
                    {{ app.utmCampaign ?? '—' }}
                  </td>
                  <!-- Status -->
                  <td class="px-4 py-3.5 text-center">
                    <!-- Фаза 1: реальный этап воронки вместо легаси-статуса -->
                    <span
                      v-if="app.currentStageName"
                      class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 whitespace-nowrap"
                    >
                      <span class="inline-flex size-1.5 rounded-full shrink-0" :style="{ backgroundColor: app.currentStageColor || '#9ca3af' }" />
                      {{ app.currentStageName }}
                    </span>
                    <span v-else class="text-[11px] text-surface-400">—</span>
                  </td>
                  <!-- Applied date -->
                  <td class="px-4 py-3.5 text-right text-[11px] text-surface-400 tabular-nums font-medium">
                    {{ formatDate(app.appliedAt) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- ═══════════════════════════════════════ -->
    <!-- Modal: Create tracking link             -->
    <!-- ═══════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="showCreateModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50 dark:bg-black/70" @click="showCreateModal = false" />
        <div class="relative w-full max-w-lg rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-2xl">
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-surface-100 dark:border-surface-800">
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Создать ссылку отслеживания</h2>
            <UiButton
              variant="ghost"
              icon-only
              size="sm"
              class="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200"
              @click="showCreateModal = false"
            >
              <X class="size-4" />
            </UiButton>
          </div>

          <!-- Body -->
          <form class="px-6 py-5 space-y-4" @submit.prevent="handleCreateLink">
            <!-- Name -->
            <div>
              <label for="link-name" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Название ссылки</label>
              <input
                id="link-name"
                v-model="newLink.name"
                type="text"
                placeholder="например, весенняя кампания в LinkedIn"
                class="w-full rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-4 py-2.5 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
              />
            </div>

            <!-- Channel -->
            <div>
              <label for="link-channel" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Канал источника</label>
              <select
                id="link-channel"
                v-model="newLink.channel"
                class="w-full rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-4 py-2.5 text-sm text-surface-900 dark:text-surface-100 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
              >
                <optgroup label="Джоб-борды">
                  <option v-for="ch in ['linkedin', 'indeed', 'glassdoor', 'ziprecruiter', 'monster', 'handshake', 'angellist', 'wellfound', 'dice', 'stackoverflow', 'weworkremotely', 'remoteok', 'builtin', 'hired', 'lever', 'greenhouse_board', 'google_jobs']" :key="ch" :value="ch">{{ getChannelLabel(ch) }}</option>
                </optgroup>
                <optgroup label="Социальные сети">
                  <option v-for="ch in ['facebook', 'twitter', 'instagram', 'tiktok', 'reddit']" :key="ch" :value="ch">{{ getChannelLabel(ch) }}</option>
                </optgroup>
                <optgroup label="Другое">
                  <option v-for="ch in ['referral', 'career_site', 'email', 'event', 'agency', 'direct', 'custom', 'other']" :key="ch" :value="ch">{{ getChannelLabel(ch) }}</option>
                </optgroup>
              </select>
            </div>

            <!-- Job (optional) -->
            <div>
              <label for="link-job" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Привязать к вакансии <span class="text-surface-400 font-normal">(необязательно)</span></label>
              <select
                id="link-job"
                v-model="newLink.jobId"
                class="w-full rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-4 py-2.5 text-sm text-surface-900 dark:text-surface-100 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
              >
                <option value="">Все вакансии (для всей организации)</option>
                <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }}</option>
              </select>
            </div>

            <!-- UTM fields (collapsible) -->
            <details class="group">
              <summary class="flex items-center gap-2 text-sm font-medium text-surface-500 dark:text-surface-400 cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors">
                <ChevronDown class="size-4 transition-transform group-open:rotate-180" />
                UTM-параметры (необязательно)
              </summary>
              <div class="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label for="utm-source" class="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">utm_source</label>
                  <input id="utm-source" v-model="newLink.utmSource" type="text" placeholder="linkedin" class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-xs text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all" />
                </div>
                <div>
                  <label for="utm-medium" class="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">utm_medium</label>
                  <input id="utm-medium" v-model="newLink.utmMedium" type="text" placeholder="social" class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-xs text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all" />
                </div>
                <div class="col-span-2">
                  <label for="utm-campaign" class="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">utm_campaign</label>
                  <input id="utm-campaign" v-model="newLink.utmCampaign" type="text" placeholder="spring-hiring-2026" class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-xs text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all" />
                </div>
              </div>
            </details>

            <!-- Footer -->
            <div class="flex items-center justify-end gap-3 pt-2">
              <UiButton
                type="button"
                variant="ghost"
                @click="showCreateModal = false"
              >
                Отмена
              </UiButton>
              <UiButton
                type="submit"
                :loading="isCreating"
                :disabled="!newLink.name.trim()"
              >
                Создать ссылку
              </UiButton>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- ═══════════════════════════════════════ -->
    <!-- Modal: Delete confirmation               -->
    <!-- ═══════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50 dark:bg-black/70" @click="showDeleteConfirm = false" />
        <div class="relative w-full max-w-sm rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-2xl p-6 text-center">
          <div class="mx-auto mb-4 flex items-center justify-center size-12 rounded-2xl bg-danger-50 dark:bg-danger-950/40">
            <Trash2 class="size-5 text-danger-600 dark:text-danger-400" />
          </div>
          <h3 class="text-base font-semibold text-surface-900 dark:text-surface-100 mb-2">Удалить ссылку отслеживания?</h3>
          <p class="text-sm text-surface-500 dark:text-surface-400 mb-6">
            Существующие данные атрибуции сохранятся, но новые переходы не будут отслеживаться.
          </p>
          <div class="flex items-center justify-center gap-3">
            <UiButton
              variant="ghost"
              @click="showDeleteConfirm = false"
            >
              Отмена
            </UiButton>
            <UiButton
              variant="danger"
              @click="handleDelete"
            >
              Удалить
            </UiButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
