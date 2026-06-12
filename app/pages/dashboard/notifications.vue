<script setup lang="ts">
/**
 * Notifications page — paginated full list with filter (all / unread).
 */
import { ref, computed, onMounted, watch } from 'vue'
import { Bell, CheckCheck, MessageSquare, AtSign, Smile, Reply } from 'lucide-vue-next'
import { useNotifications, type NotificationItem } from '~/composables/useNotifications'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const { t, locale } = useI18n()
const localePath = useLocalePath()

useHead({ title: () => `${t('notifications.title')} — Huntfork` })

const filter = ref<'all' | 'unread'>('all')
const page = ref(1)
const limit = 30
const total = ref(0)

const {
  items,
  unreadCount,
  loading,
  fetchList,
  markAsRead,
  markAllAsRead,
} = useNotifications()

async function load() {
  const res = await fetchList({
    unread: filter.value === 'unread',
    page: page.value,
    limit,
  })
  // unreadCount from API is unread total — but items length may be smaller. We don't have a precise total in API,
  // so we estimate hasMore via items length.
  total.value = res?.data?.length ?? 0
}

onMounted(() => { void load() })

watch(filter, () => {
  page.value = 1
  void load()
})

const hasMore = computed(() => items.value.length === limit)

async function nextPage() {
  page.value += 1
  await load()
}

async function prevPage() {
  if (page.value <= 1) return
  page.value -= 1
  await load()
}

function notifTypeIcon(type: NotificationItem['type']) {
  switch (type) {
    case 'mention': return AtSign
    case 'reply': return Reply
    case 'reaction': return Smile
    case 'new_comment_on_watched': return MessageSquare
    default: return Bell
  }
}

function notifTypeLabel(type: NotificationItem['type']) {
  switch (type) {
    case 'mention': return t('notifications.types.mention')
    case 'reply': return t('notifications.types.reply')
    case 'reaction': return t('notifications.types.reaction')
    case 'new_comment_on_watched': return t('notifications.types.new_comment')
    default: return ''
  }
}

function notifLink(n: NotificationItem): string {
  if (n.applicationId) return localePath(`/dashboard/applications/${n.applicationId}`)
  return localePath('/dashboard/notifications')
}

function snippet(text: string | null, max = 180): string {
  if (!text) return ''
  const stripped = text.replace(/\s+/g, ' ').trim()
  return stripped.length > max ? stripped.slice(0, max) + '…' : stripped
}

function formatDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

async function handleClick(n: NotificationItem, e: MouseEvent) {
  if (!n.readAt) {
    await markAsRead([n.id])
  }
  // allow native NuxtLink navigation
}

async function handleMarkAll() {
  await markAllAsRead()
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-100">
          {{ t('notifications.title') }}
        </h1>
        <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">
          {{ t('notifications.subtitle') }}
        </p>
      </div>
      <button
        v-if="unreadCount > 0"
        type="button"
        class="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-950/40 hover:bg-brand-100 dark:hover:bg-brand-950/60 transition-colors cursor-pointer border-0"
        @click="handleMarkAll"
      >
        <CheckCheck class="size-4" />
        {{ t('notifications.mark_all_read') }}
      </button>
    </div>

    <!-- Filter tabs -->
    <div class="flex items-center gap-2 mb-4 border-b border-surface-200 dark:border-surface-800">
      <button
        type="button"
        class="px-3 py-2 text-sm font-medium transition-colors cursor-pointer border-0 bg-transparent -mb-px border-b-2"
        :class="filter === 'all'
          ? 'text-brand-600 dark:text-brand-400 border-brand-500'
          : 'text-surface-500 dark:text-surface-400 border-transparent hover:text-surface-700 dark:hover:text-surface-200'"
        @click="filter = 'all'"
      >
        {{ t('notifications.filter.all') }}
      </button>
      <button
        type="button"
        class="px-3 py-2 text-sm font-medium transition-colors cursor-pointer border-0 bg-transparent -mb-px border-b-2 inline-flex items-center gap-2"
        :class="filter === 'unread'
          ? 'text-brand-600 dark:text-brand-400 border-brand-500'
          : 'text-surface-500 dark:text-surface-400 border-transparent hover:text-surface-700 dark:hover:text-surface-200'"
        @click="filter = 'unread'"
      >
        {{ t('notifications.filter.unread') }}
        <span
          v-if="unreadCount > 0"
          class="inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-[10px] font-semibold leading-none"
        >
          {{ unreadCount > 99 ? '99+' : unreadCount }}
        </span>
      </button>
    </div>

    <!-- List -->
    <div class="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-800 overflow-hidden">
      <div v-if="loading && items.length === 0" class="px-6 py-16 text-center text-sm text-surface-500 dark:text-surface-400">
        {{ t('notifications.loading') }}
      </div>
      <div v-else-if="items.length === 0" class="px-6 py-20 text-center">
        <Bell class="size-12 mx-auto mb-3 text-surface-300 dark:text-surface-600" />
        <div class="text-sm text-surface-500 dark:text-surface-400">
          {{ filter === 'unread' ? t('notifications.empty_unread') : t('notifications.empty') }}
        </div>
      </div>

      <NuxtLink
        v-for="n in items"
        v-else
        :key="n.id"
        :to="notifLink(n)"
        class="flex items-start gap-4 px-5 py-4 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors border-b border-surface-100 dark:border-surface-800 last:border-b-0 no-underline"
        :class="!n.readAt ? 'bg-brand-50/40 dark:bg-brand-950/20' : ''"
        @click="(e) => handleClick(n, e)"
      >
        <div class="flex-shrink-0 relative">
          <div
            v-if="n.actorImage"
            class="size-10 rounded-full bg-cover bg-center"
            :style="{ backgroundImage: `url(${n.actorImage})` }"
          />
          <div
            v-else
            class="flex items-center justify-center size-10 rounded-full bg-gradient-to-br from-surface-300 to-surface-400 dark:from-surface-700 dark:to-surface-800 text-white text-xs font-bold"
          >
            {{ (n.actorName ?? '?').slice(0, 1).toUpperCase() }}
          </div>
          <div class="absolute -bottom-0.5 -right-0.5 size-5 rounded-full bg-white dark:bg-surface-900 flex items-center justify-center ring-2 ring-white dark:ring-surface-900">
            <component :is="notifTypeIcon(n.type)" class="size-3 text-surface-500 dark:text-surface-400" />
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm text-surface-700 dark:text-surface-300">
            <span class="font-semibold text-surface-900 dark:text-surface-100">{{ n.actorName ?? t('notifications.someone') }}</span>
            <span class="text-surface-500 dark:text-surface-400">
              {{ ' ' + notifTypeLabel(n.type) }}
            </span>
          </div>
          <div v-if="n.commentBody" class="text-sm text-surface-500 dark:text-surface-400 mt-1">
            «{{ snippet(n.commentBody) }}»
          </div>
          <div class="text-xs text-surface-400 dark:text-surface-500 mt-2">
            {{ formatDate(n.createdAt) }}
          </div>
        </div>
        <div v-if="!n.readAt" class="flex-shrink-0 mt-2">
          <span class="block size-2.5 rounded-full bg-brand-500" />
        </div>
      </NuxtLink>
    </div>

    <!-- Pagination -->
    <div v-if="items.length > 0" class="flex items-center justify-between mt-4">
      <button
        type="button"
        :disabled="page <= 1"
        class="px-3 py-2 text-sm font-medium rounded-lg border border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-white dark:bg-surface-900"
        @click="prevPage"
      >
        {{ t('notifications.previous') }}
      </button>
      <div class="text-xs text-surface-500 dark:text-surface-400">
        {{ t('notifications.page', { n: page }) }}
      </div>
      <button
        type="button"
        :disabled="!hasMore"
        class="px-3 py-2 text-sm font-medium rounded-lg border border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-white dark:bg-surface-900"
        @click="nextPage"
      >
        {{ t('notifications.next') }}
      </button>
    </div>
  </div>
</template>
