<script setup lang="ts">
/**
 * Единая лента диалогов (Спринт 18.2).
 *
 * Все переписки с кандидатами по всем каналам в одном месте:
 * слева — список диалогов (поиск, фильтр непрочитанных),
 * справа — переписка (общий CommsChatPanel) + контекст отклика.
 */
import { ChevronLeft, Inbox, MessageSquare, RefreshCw, Search, SquareArrowOutUpRight } from 'lucide-vue-next'
import CommsChatPanel from '~/components/Comms/CommsChatPanel.vue'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const { t } = useI18n()
const localePath = useLocalePath()

interface InboxConversation {
  id: string
  channel: string
  state: string
  applicationId: string | null
  candidateId: string | null
  jobId: string | null
  candidateName: string | null
  jobTitle: string | null
  canWrite: boolean
  unreadCount: number
  lastMessageAt: string | null
  lastMessagePreview: string | null
  lastMessageDirection: 'in' | 'out' | null
}

const { data, pending, refresh } = await useFetch<{ items: InboxConversation[], unreadTotal: number }>(
  '/api/conversations',
  { default: () => ({ items: [], unreadTotal: 0 }) },
)

const searchQuery = ref('')
const onlyUnread = ref(false)
const selectedId = ref<string | null>(null)

const conversations = computed(() => data.value?.items ?? [])
const unreadTotal = computed(() => data.value?.unreadTotal ?? 0)

// Спринт 19.5: синхронизируем глобальный бейдж «Входящие» в навигации
const { unread: inboxUnreadShared } = useInboxUnread()
watch(unreadTotal, (v) => { inboxUnreadShared.value = v }, { immediate: true })

const filteredConversations = computed(() => {
  let list = conversations.value
  if (onlyUnread.value) list = list.filter(c => c.unreadCount > 0)
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(c =>
      (c.candidateName ?? '').toLowerCase().includes(q)
      || (c.jobTitle ?? '').toLowerCase().includes(q)
      || (c.lastMessagePreview ?? '').toLowerCase().includes(q),
    )
  }
  return list
})

const selectedConversation = computed(() =>
  conversations.value.find(c => c.id === selectedId.value) ?? null,
)

function selectConversation(c: InboxConversation) {
  selectedId.value = c.id
}

/** Панель чата отметила диалог прочитанным — гасим бейдж в списке. */
function onChatMeta(payload: { unreadCount: number }) {
  const conv = selectedConversation.value
  if (!conv || !data.value) return
  if (payload.unreadCount >= 0 && conv.unreadCount > 0) {
    data.value = {
      items: data.value.items.map(c => c.id === conv.id ? { ...c, unreadCount: 0 } : c),
      unreadTotal: Math.max(0, data.value.unreadTotal - conv.unreadCount),
    }
  }
}

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.split(' ').filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const second = parts[1]?.[0] ?? ''
  return (first + second).toUpperCase() || '?'
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })
}

const channelLabels: Record<string, string> = {
  hh: 'hh.ru',
  telegram: 'Telegram',
  email: 'Email',
  whatsapp: 'WhatsApp',
}

// Спринт 19.5: ручная привязка диалога (обычно — чата личного ТГ) к отклику
interface LinkOption {
  applicationId: string
  candidateId: string
  candidateName: string
  telegram: string | null
  jobTitle: string
}
const linkQuery = ref('')
const linkOptions = ref<LinkOption[]>([])
const linkLoading = ref(false)
const linkSaving = ref(false)
const linkError = ref<string | null>(null)
let linkTimer: ReturnType<typeof setTimeout> | null = null

async function fetchLinkOptions() {
  const conv = selectedConversation.value
  if (!conv || conv.applicationId) return
  linkLoading.value = true
  try {
    const res = await $fetch<{ items: LinkOption[] }>(`/api/conversations/${conv.id}/link-options`, {
      query: linkQuery.value.trim() ? { q: linkQuery.value.trim() } : {},
    })
    linkOptions.value = res.items
  }
  catch {
    linkOptions.value = []
  }
  finally {
    linkLoading.value = false
  }
}

watch(linkQuery, () => {
  if (linkTimer) clearTimeout(linkTimer)
  linkTimer = setTimeout(fetchLinkOptions, 300)
})

watch(selectedId, () => {
  linkQuery.value = ''
  linkOptions.value = []
  linkError.value = null
  const conv = selectedConversation.value
  if (conv && !conv.applicationId) fetchLinkOptions()
})

async function linkToApplication(applicationId: string) {
  const conv = selectedConversation.value
  if (!conv || linkSaving.value) return
  linkSaving.value = true
  linkError.value = null
  try {
    await $fetch(`/api/conversations/${conv.id}/link`, { method: 'POST', body: { applicationId } })
    await refresh()
  }
  catch {
    linkError.value = t('dashboard.inbox.linkError')
  }
  finally {
    linkSaving.value = false
  }
}

// Фоновое обновление списка (30с, только при видимой вкладке)
let pollTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    refresh()
  }, 30000)
})
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})

useHead({ title: () => `${t('dashboard.inbox.title')} — Huntfork` })
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 sm:px-6 py-6">
    <!-- Заголовок -->
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-3">
        <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-50">
          {{ t('dashboard.inbox.title') }}
        </h1>
        <span
          v-if="unreadTotal > 0"
          class="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-brand-600 text-white text-xs font-semibold tabular-nums"
        >
          {{ unreadTotal }}
        </span>
      </div>
      <button
        class="cursor-pointer inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
        :disabled="pending"
        @click="refresh()"
      >
        <RefreshCw class="size-3.5" :class="pending ? 'animate-spin' : ''" />
        {{ t('dashboard.inbox.refresh') }}
      </button>
    </div>

    <div class="flex gap-5 items-start">
      <!-- Список диалогов -->
      <div
        class="w-full md:w-96 shrink-0 flex-col rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 shadow-sm shadow-surface-900/[0.03] dark:shadow-none overflow-hidden"
        :class="selectedConversation ? 'hidden md:flex' : 'flex'"
      >
        <!-- Поиск и фильтры -->
        <div class="p-3 border-b border-surface-200/80 dark:border-surface-800/60 space-y-2">
          <div class="relative">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-surface-400" />
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('dashboard.inbox.searchPlaceholder')"
              class="w-full rounded-lg border border-surface-200/80 dark:border-surface-700/60 bg-surface-50 dark:bg-surface-900 pl-9 pr-3 py-2 text-sm text-surface-800 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
          </div>
          <div class="flex items-center gap-2">
            <button
              class="cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors"
              :class="!onlyUnread ? 'bg-brand-600 text-white' : 'bg-surface-100 dark:bg-surface-800/60 text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'"
              @click="onlyUnread = false"
            >
              {{ t('dashboard.inbox.filterAll') }}
            </button>
            <button
              class="cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors"
              :class="onlyUnread ? 'bg-brand-600 text-white' : 'bg-surface-100 dark:bg-surface-800/60 text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'"
              @click="onlyUnread = true"
            >
              {{ t('dashboard.inbox.filterUnread') }}
              <span v-if="unreadTotal > 0" class="tabular-nums">· {{ unreadTotal }}</span>
            </button>
          </div>
        </div>

        <!-- Элементы списка -->
        <div class="overflow-y-auto max-h-[calc(100vh-16rem)]">
          <div v-if="pending && conversations.length === 0" class="text-center py-12 text-surface-400">
            <div class="size-6 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin mx-auto" />
          </div>
          <div v-else-if="filteredConversations.length === 0" class="text-center py-12 px-4">
            <div class="flex size-12 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
              <Inbox class="size-5 text-surface-400 dark:text-surface-500" />
            </div>
            <p class="text-sm text-surface-500 dark:text-surface-400">
              {{ onlyUnread || searchQuery ? t('dashboard.inbox.emptyFiltered') : t('dashboard.inbox.empty') }}
            </p>
            <p v-if="!onlyUnread && !searchQuery" class="text-xs text-surface-400 dark:text-surface-500 mt-1.5">
              {{ t('dashboard.inbox.emptyHint') }}
            </p>
          </div>
          <button
            v-for="c in filteredConversations"
            :key="c.id"
            class="cursor-pointer w-full text-left px-3 py-3 flex gap-3 items-start border-b border-surface-100 dark:border-surface-800/40 last:border-b-0 transition-colors"
            :class="selectedId === c.id
              ? 'bg-brand-50 dark:bg-brand-950/30'
              : 'hover:bg-surface-50 dark:hover:bg-surface-900/60'"
            @click="selectConversation(c)"
          >
            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800/60 text-xs font-semibold text-surface-500 dark:text-surface-300">
              {{ initials(c.candidateName) }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium text-surface-900 dark:text-surface-100" :class="c.unreadCount > 0 ? 'font-semibold' : ''">
                  {{ c.candidateName ?? t('dashboard.inbox.unknownCandidate') }}
                </span>
                <span class="shrink-0 text-[11px] text-surface-400 tabular-nums">{{ formatTime(c.lastMessageAt) }}</span>
              </div>
              <div class="flex items-center gap-1.5 mt-0.5">
                <span class="shrink-0 rounded bg-surface-100 dark:bg-surface-800/60 px-1.5 py-px text-[10px] font-medium text-surface-500 dark:text-surface-400">
                  {{ channelLabels[c.channel] ?? c.channel }}
                </span>
                <span v-if="c.jobTitle" class="truncate text-xs text-surface-400 dark:text-surface-500">{{ c.jobTitle }}</span>
              </div>
              <div class="flex items-center justify-between gap-2 mt-1">
                <p class="truncate text-xs text-surface-500 dark:text-surface-400">
                  <template v-if="c.lastMessageDirection === 'out'">{{ t('dashboard.inbox.youPrefix') }} </template>{{ c.lastMessagePreview ?? '—' }}
                </p>
                <span
                  v-if="c.unreadCount > 0"
                  class="shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-brand-600 text-white text-[10px] font-semibold tabular-nums"
                >
                  {{ c.unreadCount }}
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Переписка -->
      <div
        class="flex-1 min-w-0 flex-col"
        :class="selectedConversation ? 'flex' : 'hidden md:flex'"
      >
        <div
          v-if="!selectedConversation"
          class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-12 text-center shadow-sm shadow-surface-900/[0.03] dark:shadow-none"
        >
          <div class="flex size-14 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
            <MessageSquare class="size-6 text-surface-400 dark:text-surface-500" />
          </div>
          <p class="text-sm font-medium text-surface-600 dark:text-surface-300">{{ t('dashboard.inbox.selectConversation') }}</p>
          <p class="text-xs text-surface-400 dark:text-surface-500 mt-1.5">{{ t('dashboard.inbox.selectConversationHint') }}</p>
        </div>

        <div v-else class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 shadow-sm shadow-surface-900/[0.03] dark:shadow-none">
          <!-- Шапка диалога -->
          <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-200/80 dark:border-surface-800/60">
            <div class="flex items-center gap-3 min-w-0">
              <button
                class="cursor-pointer md:hidden inline-flex items-center justify-center size-8 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
                @click="selectedId = null"
              >
                <ChevronLeft class="size-5" />
              </button>
              <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800/60 text-xs font-semibold text-surface-500 dark:text-surface-300">
                {{ initials(selectedConversation.candidateName) }}
              </div>
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-surface-900 dark:text-surface-100">
                  {{ selectedConversation.candidateName ?? t('dashboard.inbox.unknownCandidate') }}
                </p>
                <p class="truncate text-xs text-surface-400 dark:text-surface-500">
                  {{ channelLabels[selectedConversation.channel] ?? selectedConversation.channel }}<template v-if="selectedConversation.jobTitle"> · {{ selectedConversation.jobTitle }}</template>
                </p>
              </div>
            </div>
            <NuxtLink
              v-if="selectedConversation.applicationId"
              :to="localePath(`/dashboard/applications/${selectedConversation.applicationId}`)"
              class="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-surface-200/80 dark:border-surface-700/60 px-2.5 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-900/60 transition-colors"
            >
              <SquareArrowOutUpRight class="size-3.5" />
              <span class="hidden sm:inline">{{ t('dashboard.inbox.openApplication') }}</span>
            </NuxtLink>
          </div>

          <!-- Чат -->
          <div class="p-4">
            <CommsChatPanel
              v-if="selectedConversation.applicationId"
              :application-id="selectedConversation.applicationId"
              @meta="onChatMeta"
            />
            <div v-else class="py-6 max-w-md mx-auto">
              <p class="text-sm text-center text-surface-500 dark:text-surface-400">{{ t('dashboard.inbox.noApplication') }}</p>
              <p class="text-xs text-center text-surface-400 dark:text-surface-500 mt-1 mb-4">{{ t('dashboard.inbox.linkHint') }}</p>
              <div class="relative mb-3">
                <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-surface-400" />
                <input
                  v-model="linkQuery"
                  type="text"
                  :placeholder="t('dashboard.inbox.linkSearchPlaceholder')"
                  class="w-full rounded-lg border border-surface-200/80 dark:border-surface-700/60 bg-white dark:bg-surface-950 pl-9 pr-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                >
              </div>
              <div v-if="linkLoading" class="text-center py-4 text-xs text-surface-400">…</div>
              <ul v-else-if="linkOptions.length > 0" class="space-y-1.5">
                <li v-for="opt in linkOptions" :key="opt.applicationId">
                  <button
                    class="cursor-pointer w-full text-left rounded-lg border border-surface-200/80 dark:border-surface-700/60 px-3 py-2 hover:bg-surface-50 dark:hover:bg-surface-900/60 transition-colors disabled:opacity-50"
                    :disabled="linkSaving"
                    @click="linkToApplication(opt.applicationId)"
                  >
                    <p class="text-sm font-medium text-surface-800 dark:text-surface-200">{{ opt.candidateName }}</p>
                    <p class="text-xs text-surface-400 dark:text-surface-500">{{ opt.jobTitle }}<template v-if="opt.telegram"> · {{ opt.telegram }}</template></p>
                  </button>
                </li>
              </ul>
              <p v-else class="text-center py-4 text-xs text-surface-400">{{ t('dashboard.inbox.linkNoResults') }}</p>
              <p v-if="linkError" class="text-center mt-2 text-xs text-red-500">{{ linkError }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
