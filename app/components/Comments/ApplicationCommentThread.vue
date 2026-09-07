<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { MessageSquare, Users, Plus, X, Eye, Bot, ShieldAlert } from 'lucide-vue-next'
import ApplicationCommentItem from './ApplicationCommentItem.vue'
import ApplicationCommentComposer from './ApplicationCommentComposer.vue'
import ThreadStageEvent from './ThreadStageEvent.vue'
import { useApplicationComments } from '~/composables/useApplicationComments'

const props = withDefaults(
  defineProps<{
    applicationId: string
    /** Compact layout for drawer/sidebar usage */
    compact?: boolean
    /**
     * Collaboration Hub (Этап 1): просмотр треда чужого отклика кандидата.
     * Скрывает композер, действия, реакции-тоглы и управление watchers.
     * Запись возможна только в текущий (активный) отклик.
     */
    readOnly?: boolean
  }>(),
  { compact: false, readOnly: false },
)

const { t } = useI18n()
const { data: session } = await authClient.useSession(useFetch)
const currentUserId = computed(() => session.value?.user?.id ?? '')

// Resolve current member role via Better Auth
const currentRole = ref<string>('')
onMounted(async () => {
  try {
    const { data } = await authClient.organization.getActiveMemberRole()
    currentRole.value = (data?.role as string) ?? ''
  } catch {}
})

const {
  comments,
  watchers,
  timeline,
  loading,
  error,
  fetchComments,
  fetchWatchers,
  fetchStageHistory,
  connectStream,
  addWatcher,
  removeWatcher,
  toggleReaction,
  attachSnapshot,
  searchMembers,
} = useApplicationComments(props.applicationId)

const toast = useToast()
const pinning = ref(false)
async function onAttachSnapshot(kind: 'ai_screening_snapshot' | 'risk_snapshot') {
  if (pinning.value) return
  pinning.value = true
  try {
    await attachSnapshot(kind)
    void fetchComments()
  } catch {
    // toast уже показан в composable
  } finally {
    pinning.value = false
  }
}

function onReactionToggle(commentId: string, emoji: string) {
  if (props.readOnly) return
  void toggleReaction(commentId, emoji, currentUserId.value)
}

const canSeeInternal = computed(() => ['owner', 'admin', 'recruiter'].includes(currentRole.value))
const canDeleteAny = computed(() => ['owner', 'admin'].includes(currentRole.value))

const composerRef = ref<InstanceType<typeof ApplicationCommentComposer> | null>(null)
const replyTo = ref<string | null>(null)

let disconnectStream: (() => void) | null = null
onMounted(async () => {
  await Promise.all([fetchComments(), fetchWatchers(), fetchStageHistory()])
  // Realtime: подписка на изменения треда (новые сообщения/снимки/этапы)
  disconnectStream = connectStream()
})
onBeforeUnmount(() => {
  disconnectStream?.()
})

function onSubmitted() {
  replyTo.value = null
  // Re-fetch to get authoritative state (mentions w/ names, server timestamps)
  void fetchComments()
}
function onCancelReply() {
  replyTo.value = null
}
function onReply(parentId: string) {
  replyTo.value = parentId
  setTimeout(() => composerRef.value?.focus(), 50)
}

// Watcher panel
const watchersOpen = ref(false)
const watcherSearchQuery = ref('')
const watcherSearchResults = ref<Awaited<ReturnType<typeof searchMembers>>>([])

async function refreshWatcherSearch() {
  if (!watcherSearchQuery.value.trim()) {
    watcherSearchResults.value = []
    return
  }
  watcherSearchResults.value = await searchMembers(watcherSearchQuery.value.trim())
}

async function onAddWatcher(userId: string) {
  await addWatcher(userId)
  watcherSearchQuery.value = ''
  watcherSearchResults.value = []
}

const watcherUserIds = computed(() => new Set(watchers.value.map(w => w.userId)))
const watcherCandidates = computed(() =>
  watcherSearchResults.value.filter(m => !watcherUserIds.value.has(m.userId)),
)
</script>

<template>
  <section
    class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900"
    :class="compact ? '' : 'p-5'"
  >
    <!-- Header -->
    <header class="flex items-center justify-between gap-2" :class="compact ? 'px-4 pt-4' : 'mb-4'">
      <div class="flex items-center gap-2">
        <MessageSquare class="size-4 text-surface-500 dark:text-surface-400" />
        <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200">
          {{ t('comments.thread_title') }}
        </h2>
        <span v-if="comments.length > 0" class="rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-xs text-surface-600 dark:text-surface-300">
          {{ comments.length }}
        </span>
      </div>
      <button
        type="button"
        class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer"
        @click="watchersOpen = !watchersOpen"
      >
        <Users class="size-3.5" />
        {{ t('watchers.label') }}
        <span class="rounded-full bg-surface-200 dark:bg-surface-700 px-1.5 text-[10px]">{{ watchers.length }}</span>
      </button>
    </header>

    <!-- Watcher panel -->
    <div
      v-if="watchersOpen"
      class="border-t border-b border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950/40"
      :class="compact ? 'px-4 py-3' : 'mb-4 -mx-5 px-5 py-3'"
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="text-xs font-medium text-surface-700 dark:text-surface-300">{{ t('watchers.subscribed') }}</span>
      </div>
      <ul v-if="watchers.length > 0" class="space-y-1 mb-3">
        <li
          v-for="w in watchers"
          :key="w.userId"
          class="flex items-center justify-between gap-2 rounded-md bg-white dark:bg-surface-900 px-2 py-1"
        >
          <div class="flex items-center gap-2 min-w-0">
            <div class="flex h-6 w-6 items-center justify-center rounded-full bg-surface-200 dark:bg-surface-700 text-[10px] font-semibold text-surface-700 dark:text-surface-200">
              <img v-if="w.image" :src="w.image" :alt="w.name ?? ''" class="h-6 w-6 rounded-full">
              <span v-else>{{ (w.name ?? w.email ?? '?').slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs text-surface-900 dark:text-surface-100">{{ w.name || w.email }}</div>
              <div class="truncate text-[10px] text-surface-500">{{ t(`watchers.source_${w.source}`) }}</div>
            </div>
          </div>
          <button
            v-if="!readOnly"
            type="button"
            class="rounded p-1 text-surface-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer"
            :title="t('watchers.remove')"
            @click="removeWatcher(w.userId)"
          >
            <X class="size-3.5" />
          </button>
        </li>
      </ul>
      <p v-else class="mb-2 text-xs italic text-surface-400">{{ t('watchers.empty') }}</p>

      <!-- Add watcher -->
      <div v-if="!readOnly" class="relative">
        <input
          v-model="watcherSearchQuery"
          type="text"
          :placeholder="t('watchers.add_placeholder')"
          class="w-full rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-2.5 py-1.5 text-xs text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          @input="refreshWatcherSearch"
        >
        <ul
          v-if="watcherCandidates.length > 0"
          class="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow"
        >
          <li
            v-for="m in watcherCandidates"
            :key="m.userId"
            class="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-brand-50 dark:hover:bg-surface-800"
            @mousedown.prevent="onAddWatcher(m.userId)"
          >
            <Plus class="size-3 text-brand-600" />
            <span class="truncate">{{ m.name || m.email }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- Thread -->
    <div :class="compact ? 'px-2 pb-2' : ''">
      <div v-if="loading && comments.length === 0" class="py-8 text-center text-sm text-surface-400">
        {{ t('comments.loading') }}
      </div>
      <div v-else-if="error" class="py-4 text-center text-sm text-red-600">
        {{ error }}
      </div>
      <div v-else-if="timeline.length === 0" class="py-6 text-center text-sm text-surface-400 italic">
        {{ t('comments.empty') }}
      </div>
      <div v-else class="space-y-1">
        <template v-for="item in timeline" :key="`${item.type}-${item.type === 'comment' ? item.comment.id : item.event.id}`">
          <ApplicationCommentItem
            v-if="item.type === 'comment'"
            :application-id="applicationId"
            :comment="item.comment"
            :current-user-id="currentUserId"
            :can-delete-any="canDeleteAny"
            :can-reply="false"
            :read-only="readOnly"
            @reply="onReply"
            @reaction-toggle="onReactionToggle"
          />
          <ThreadStageEvent
            v-else
            :event="item.event"
          />
        </template>
      </div>

      <!-- Composer (только текущий отклик) / баннер «только просмотр» для чужих откликов -->
      <div :class="compact ? 'px-2 pb-3 pt-2' : 'mt-3'">
        <div
          v-if="readOnly"
          class="flex items-center gap-2 rounded-lg border border-dashed border-rose-300 dark:border-rose-800/60 bg-rose-50/60 dark:bg-rose-900/10 px-3 py-2.5 text-xs text-rose-700 dark:text-rose-300"
        >
          <Eye class="size-3.5 flex-shrink-0" />
          <span>{{ t('comments.read_only_other_application') }}</span>
        </div>
        <template v-else>
          <!-- Прикрепить результат ИИ в ленту (Этап 3) -->
          <div class="mb-2 flex flex-wrap items-center gap-1.5">
            <span class="text-[11px] text-surface-400">{{ t('comment_snapshot.attach_label') }}:</span>
            <button
              type="button"
              :disabled="pinning"
              class="inline-flex items-center gap-1 rounded-md border border-brand-200 dark:border-brand-800/60 bg-brand-50/50 dark:bg-brand-900/10 px-2 py-1 text-[11px] font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/30 disabled:opacity-50 cursor-pointer"
              @click="onAttachSnapshot('ai_screening_snapshot')"
            >
              <Bot class="size-3" />
              {{ t('discussion_widgets.screening') }}
            </button>
            <button
              type="button"
              :disabled="pinning"
              class="inline-flex items-center gap-1 rounded-md border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-900/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50 cursor-pointer"
              @click="onAttachSnapshot('risk_snapshot')"
            >
              <ShieldAlert class="size-3" />
              {{ t('discussion_widgets.risk') }}
            </button>
          </div>
          <ApplicationCommentComposer
            ref="composerRef"
            :application-id="applicationId"
            :can-mark-internal="canSeeInternal"
            :parent-comment-id="replyTo"
            @submitted="onSubmitted"
            @cancel="onCancelReply"
          />
        </template>
      </div>
    </div>
  </section>
</template>
