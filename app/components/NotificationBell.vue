<script setup lang="ts">
/**
 * Notification bell dropdown — mounted in AppTopBar.
 * Polls /api/notifications?unread=true every 60s, shows badge + recent list.
 */
import { ref, useTemplateRef, computed } from 'vue'
import { Bell, Check, CheckCheck, MessageSquare, AtSign, Smile, Reply } from 'lucide-vue-next'
import { useNotifications, type NotificationItem } from '~/composables/useNotifications'

const { t, locale } = useI18n()
const localePath = useLocalePath()

const open = ref(false)
const bellRef = useTemplateRef<HTMLElement>('bellRoot')

const {
  items,
  unreadCount,
  hasUnread,
  loading,
  fetchUnreadCount,
  fetchList,
  markAsRead,
  markAllAsRead,
} = useNotifications({ autoPoll: true, pollMs: 60_000 })

function onClickOutside(e: MouseEvent) {
  if (bellRef.value && !bellRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

watch(open, async (isOpen) => {
  if (isOpen) {
    document.addEventListener('click', onClickOutside)
    document.addEventListener('keydown', onEsc)
    await fetchList({ limit: 10 })
  } else {
    document.removeEventListener('click', onClickOutside)
    document.removeEventListener('keydown', onEsc)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  document.removeEventListener('keydown', onEsc)
})

const badge = computed(() => {
  if (unreadCount.value <= 0) return ''
  if (unreadCount.value > 99) return '99+'
  return String(unreadCount.value)
})

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

function snippet(text: string | null, max = 100): string {
  if (!text) return ''
  const stripped = text.replace(/\s+/g, ' ').trim()
  return stripped.length > max ? stripped.slice(0, max) + '…' : stripped
}

function formatTime(d: string | Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return t('notifications.time.now')
  if (diffMin < 60) return t('notifications.time.minutes', { n: diffMin })
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return t('notifications.time.hours', { n: diffHr })
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return t('notifications.time.days', { n: diffDay })
  return date.toLocaleDateString(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric', month: 'short',
  })
}

async function handleItemClick(n: NotificationItem) {
  if (!n.readAt) {
    await markAsRead([n.id])
  }
  open.value = false
  await navigateTo(notifLink(n))
}

async function handleMarkAll() {
  await markAllAsRead()
}

async function toggleOpen() {
  open.value = !open.value
}
</script>

<template>
  <div ref="bellRoot" class="relative">
    <button
      type="button"
      class="inline-flex items-center justify-center size-8 rounded-lg text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all duration-200 cursor-pointer border-0 bg-transparent relative"
      :title="t('notifications.title')"
      :aria-label="t('notifications.title')"
      @click="toggleOpen"
    >
      <Bell class="size-4" />
      <span
        v-if="hasUnread"
        class="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none ring-2 ring-white dark:ring-surface-950"
      >
        {{ badge }}
      </span>
    </button>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 scale-95 -translate-y-1"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-95 -translate-y-1"
    >
      <div
        v-if="open"
        class="absolute right-0 top-[calc(100%+6px)] w-[380px] max-w-[calc(100vw-32px)] rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl shadow-surface-900/8 dark:shadow-surface-950/30 overflow-hidden z-50"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-surface-100 dark:border-surface-800">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">
              {{ t('notifications.title') }}
            </span>
            <span
              v-if="hasUnread"
              class="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-[10px] font-semibold leading-none"
            >
              {{ badge }}
            </span>
          </div>
          <button
            v-if="hasUnread"
            type="button"
            class="inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 cursor-pointer border-0 bg-transparent p-0"
            @click="handleMarkAll"
          >
            <CheckCheck class="size-3.5" />
            {{ t('notifications.mark_all_read') }}
          </button>
        </div>

        <!-- List -->
        <div class="max-h-[420px] overflow-y-auto">
          <div v-if="loading && items.length === 0" class="px-4 py-8 text-center text-xs text-surface-500 dark:text-surface-400">
            {{ t('notifications.loading') }}
          </div>
          <div v-else-if="items.length === 0" class="px-4 py-12 text-center">
            <Bell class="size-8 mx-auto mb-2 text-surface-300 dark:text-surface-600" />
            <div class="text-sm text-surface-500 dark:text-surface-400">
              {{ t('notifications.empty') }}
            </div>
          </div>
          <button
            v-for="n in items"
            v-else
            :key="n.id"
            type="button"
            class="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors cursor-pointer border-0 bg-transparent border-b border-surface-100 dark:border-surface-800 last:border-b-0"
            :class="!n.readAt ? 'bg-brand-50/40 dark:bg-brand-950/20' : ''"
            @click="handleItemClick(n)"
          >
            <div class="flex-shrink-0 relative">
              <div
                v-if="n.actorImage"
                class="size-8 rounded-full bg-cover bg-center"
                :style="{ backgroundImage: `url(${n.actorImage})` }"
              />
              <div
                v-else
                class="flex items-center justify-center size-8 rounded-full bg-gradient-to-br from-surface-300 to-surface-400 dark:from-surface-700 dark:to-surface-800 text-white text-[10px] font-bold"
              >
                {{ (n.actorName ?? '?').slice(0, 1).toUpperCase() }}
              </div>
              <div class="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-white dark:bg-surface-900 flex items-center justify-center ring-2 ring-white dark:ring-surface-900">
                <component :is="notifTypeIcon(n.type)" class="size-2.5 text-surface-500 dark:text-surface-400" />
              </div>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] text-surface-700 dark:text-surface-300">
                <span class="font-semibold">{{ n.actorName ?? t('notifications.someone') }}</span>
                <span class="text-surface-500 dark:text-surface-400">
                  {{ ' ' + notifTypeLabel(n.type) }}
                </span>
              </div>
              <div v-if="n.commentBody" class="text-xs text-surface-500 dark:text-surface-400 mt-0.5 line-clamp-2">
                «{{ snippet(n.commentBody, 120) }}»
              </div>
              <div class="text-[10px] text-surface-400 dark:text-surface-500 mt-1">
                {{ formatTime(n.createdAt) }}
              </div>
            </div>
            <div v-if="!n.readAt" class="flex-shrink-0 mt-1.5">
              <span class="block size-2 rounded-full bg-brand-500" />
            </div>
          </button>
        </div>

        <!-- Footer -->
        <NuxtLink
          :to="localePath('/dashboard/notifications')"
          class="block px-4 py-2.5 text-center text-[12px] font-medium text-brand-600 dark:text-brand-400 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors border-t border-surface-100 dark:border-surface-800 no-underline"
          @click="open = false"
        >
          {{ t('notifications.see_all') }}
        </NuxtLink>
      </div>
    </Transition>
  </div>
</template>
