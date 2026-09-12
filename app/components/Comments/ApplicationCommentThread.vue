<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, nextTick } from 'vue'
import { MessageSquare, Users, Eye, Bot, ShieldAlert, ArrowDown, Search } from 'lucide-vue-next'
import ApplicationCommentItem from './ApplicationCommentItem.vue'
import ApplicationCommentComposer from './ApplicationCommentComposer.vue'
import ThreadStageEvent from './ThreadStageEvent.vue'
import AiSummaryCard from './AiSummaryCard.vue'
import WatcherPanel from './WatcherPanel.vue'
import InlineStageActions from './InlineStageActions.vue'
import SmartSuggestions from './SmartSuggestions.vue'
import ReadReceipts from './ReadReceipts.vue'
import { useApplicationComments } from '~/composables/useApplicationComments'
import { groupTimeline, type RenderUnit } from '~/composables/useCommentGroups'
import { useThreadScroll } from '~/composables/useThreadScroll'
import { useThreadFilter, type ThreadFilter } from '~/composables/useThreadFilter'
import { useUnreadComments } from '~/composables/useUnreadComments'

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
  summarize,
  typingUsers,
} = useApplicationComments(props.applicationId)

const toast = useToast()
const pinning = ref(false)
const summarizing = ref(false)

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

async function onSummarize() {
  if (summarizing.value) return
  summarizing.value = true
  try {
    await summarize()
    void fetchComments()
  } catch {
    // toast уже показан в composable
  } finally {
    summarizing.value = false
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
const highlightedCommentId = ref<string | null>(null)
const route = useRoute()

let disconnectStream: (() => void) | null = null
onMounted(async () => {
  await Promise.all([fetchComments(), fetchWatchers(), fetchStageHistory()])
  disconnectStream = connectStream()
  // Mark thread as read
  const { markRead } = useUnreadComments()
  void markRead(props.applicationId)
  // Deep-link: scroll to #comment-{id}
  if (route.hash?.startsWith('#comment-')) {
    const targetId = route.hash.slice('#comment-'.length)
    highlightedCommentId.value = targetId
    nextTick(() => {
      const el = document.getElementById(`comment-${targetId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => { highlightedCommentId.value = null }, 2500)
    })
  }
  // Keyboard shortcuts
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  disconnectStream?.()
  document.removeEventListener('keydown', onKeydown)
})

// ── Keyboard shortcuts ──
function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
  if (inInput) {
    if (e.key === 'Escape') (e.target as HTMLElement)?.blur()
    return
  }
  if (e.key === '/') { e.preventDefault(); focusSearch(); return }
  if (e.key === 'c' || e.key === 'C') { e.preventDefault(); composerRef.value?.focus(); return }
  if (e.key === 'Escape') { searchOpen.value = false; searchQuery.value = ''; return }
  // J/K navigation
  if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
    e.preventDefault()
    navigateHighlight(1)
  } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
    e.preventDefault()
    navigateHighlight(-1)
  }
}

function navigateHighlight(dir: 1 | -1) {
  const ids = filteredUnits.value.flatMap(u =>
    u.type === 'group' ? u.comments.map(c => c.id) : u.item.type === 'comment' ? [u.item.comment.id] : [],
  )
  if (ids.length === 0) return
  const currentIdx = highlightedCommentId.value ? ids.indexOf(highlightedCommentId.value) : -1
  const nextIdx = Math.min(ids.length - 1, Math.max(0, currentIdx + dir))
  highlightedCommentId.value = ids[nextIdx]!
  nextTick(() => {
    const el = document.getElementById(`comment-${ids[nextIdx]}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

function onSubmitted() {
  replyTo.value = null
  void fetchComments()
}
function onCancelReply() {
  replyTo.value = null
}
function onReply(parentId: string) {
  replyTo.value = parentId
  setTimeout(() => composerRef.value?.focus(), 50)
}

// ── Grouping (Telegram-style) ──
const aiSummaries = computed(() => comments.value.filter(c => c.kind === 'ai_summary'))
const timelineForGrouping = computed(() =>
  timeline.value.filter(item => !(item.type === 'comment' && item.comment.kind === 'ai_summary')),
)
const renderUnits = computed<RenderUnit[]>(() =>
  groupTimeline(timelineForGrouping.value, currentUserId.value),
)

// ── Filter / Focus mode ──
const { active: activeFilter, filtered: filteredUnits, counts: filterCounts } = useThreadFilter(renderUnits)

// ── In-thread search ──
const searchQuery = ref('')
const searchOpen = ref(false)
const searchMatches = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  return comments.value
    .filter(c => c.body.toLowerCase().includes(q))
    .map(c => ({ id: c.id, snippet: c.body.slice(0, 80) }))
})
const searchMatchIdx = ref(0)
function focusSearch() { searchOpen.value = true; nextTick(() => searchInputRef.value?.focus()) }
function searchNext() { if (searchMatches.value.length) searchMatchIdx.value = (searchMatchIdx.value + 1) % searchMatches.value.length }
function searchPrev() { if (searchMatches.value.length) searchMatchIdx.value = (searchMatchIdx.value - 1 + searchMatches.value.length) % searchMatches.value.length }
const searchInputRef = ref<HTMLInputElement | null>(null)

// ── Fixed-height scroll ──
const scrollRef = ref<HTMLElement | null>(null)
const { showJumpFab, scrollToBottom } = useThreadScroll(scrollRef, computed(() => filteredUnits.value.length))

// ── Compact header ──
const watchersOpen = ref(false)
</script>

<template>
  <section
    class="relative flex flex-col rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden"
    :class="compact ? 'max-h-[640px]' : ''"
  >
    <!-- Compact header -->
    <header
      class="flex items-center justify-between gap-2 border-b border-surface-100 dark:border-surface-800"
      :class="compact ? 'px-3 py-2' : 'px-4 py-2.5'"
    >
      <div class="flex items-center gap-2">
        <MessageSquare class="size-4 text-brand-500" />
        <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200">
          {{ t('comments.thread_title') }}
        </h2>
        <span v-if="comments.length > 0" class="rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-xs tabular-nums text-surface-600 dark:text-surface-300">
          {{ comments.length }}
        </span>
      </div>
      <div class="flex items-center gap-1">
        <!-- In-thread search -->
        <button
          v-if="comments.length > 0"
          type="button"
          class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer transition-colors"
          :class="searchOpen ? 'bg-surface-100 dark:bg-surface-800' : ''"
          @click="focusSearch"
        >
          <Search class="size-3.5" />
        </button>
        <!-- AI-резюме (accent = AI) -->
        <button
          v-if="!readOnly"
          type="button"
          :disabled="summarizing"
          class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent-600 dark:text-accent-400 hover:bg-accent-50 dark:hover:bg-accent-900/20 disabled:opacity-50 cursor-pointer transition-colors"
          @click="onSummarize"
        >
          <Bot class="size-3.5" :class="summarizing ? 'animate-spin' : ''" />
          <span class="hidden sm:inline">{{ summarizing ? t('comments.summarizing') : t('comments.summarize') }}</span>
        </button>
        <UiButton
          variant="ghost"
          size="sm"
          @click="watchersOpen = !watchersOpen"
        >
          <Users class="size-3.5" />
          <span class="hidden sm:inline">{{ t('watchers.label') }}</span>
          <span class="rounded-full bg-surface-200 dark:bg-surface-700 px-1.5 text-[10px] tabular-nums">{{ watchers.length }}</span>
        </UiButton>
        <!-- Inline stage actions -->
        <InlineStageActions
          v-if="!readOnly"
          :application-id="applicationId"
          :compact="compact"
          @moved="void fetchStageHistory()"
        />
      </div>
    </header>

    <!-- Watcher panel (extracted) -->
    <WatcherPanel
      v-if="watchersOpen"
      :watchers="watchers"
      :search-members="searchMembers"
      :add-watcher="addWatcher"
      :remove-watcher="removeWatcher"
      :read-only="readOnly"
      :compact="compact"
    />

    <!-- Search bar -->
    <div
      v-if="searchOpen"
      class="flex items-center gap-2 border-b border-surface-100 dark:border-surface-800 bg-surface-50 dark:bg-surface-950/40 px-3 py-1.5"
    >
      <Search class="size-3.5 text-surface-400 flex-shrink-0" />
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        type="text"
        :placeholder="t('comments.search_placeholder')"
        class="flex-1 bg-transparent text-xs text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none"
        @keydown.enter.prevent="searchNext"
        @keydown.esc="searchOpen = false; searchQuery = ''"
      >
      <span v-if="searchMatches.length > 0" class="text-[10px] tabular-nums text-surface-400">
        {{ searchMatchIdx + 1 }}/{{ searchMatches.length }}
      </span>
      <button v-if="searchMatches.length > 0" type="button" class="rounded p-0.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 cursor-pointer" @click="searchPrev">↑</button>
      <button v-if="searchMatches.length > 0" type="button" class="rounded p-0.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 cursor-pointer" @click="searchNext">↓</button>
      <button type="button" class="rounded p-0.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 cursor-pointer" @click="searchOpen = false; searchQuery = ''">✕</button>
    </div>

    <!-- Filter chips -->
    <div
      v-if="comments.length > 0 && !loading"
      class="flex items-center gap-1 border-b border-surface-100 dark:border-surface-800 px-3 py-1"
    >
      <button
        v-for="f in (['all', 'comments', 'internal', 'ai', 'events'] as ThreadFilter[])"
        :key="f"
        type="button"
        class="rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer"
        :class="activeFilter === f
          ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300'
          : 'text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'"
        @click="activeFilter = f"
      >
        {{ t(`comments.filter_${f}`) }}
        <span v-if="f !== 'all' && filterCounts[f as keyof typeof filterCounts] > 0" class="ml-0.5 tabular-nums opacity-70">
          {{ filterCounts[f as keyof typeof filterCounts] }}
        </span>
      </button>
    </div>

    <!-- Fixed-height scrollable thread -->
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto scrollbar-thin"
      :class="compact ? 'max-h-[420px] px-3 py-2' : 'max-h-[560px] px-4 py-3'"
    >
      <div v-if="loading && comments.length === 0" class="py-8 text-center text-sm text-surface-400">
        <span class="inline-block size-4 animate-spin rounded-full border-2 border-surface-300 border-t-brand-500 align-middle mr-2" />
        {{ t('comments.loading') }}
      </div>
      <div v-else-if="error" class="py-4 text-center text-sm text-danger-600 dark:text-danger-400">
        {{ error }}
      </div>
      <div v-else-if="timeline.length === 0" class="py-6 text-center text-sm text-surface-400 italic">
        {{ t('comments.empty') }}
      </div>
      <div v-else>
        <!-- AI-резюме (TL;DR) — карточки сверху -->
        <AiSummaryCard
          v-for="s in aiSummaries"
          :key="s.id"
          :comment="s"
          :can-refresh="!readOnly"
          class="mb-3"
          @refresh="onSummarize"
        />

        <!-- Сгруппированная лента -->
        <template v-for="(unit, ui) in filteredUnits" :key="`u-${ui}`">
          <template v-if="unit.type === 'group'">
            <ApplicationCommentItem
              v-for="(comment, ci) in unit.comments"
              :key="comment.id"
              :application-id="applicationId"
              :comment="comment"
              :current-user-id="currentUserId"
              :can-delete-any="canDeleteAny"
              :can-reply="!readOnly"
              :read-only="readOnly"
              :is-first-in-group="ci === 0"
              :is-last-in-group="ci === unit.comments.length - 1"
              :highlighted="highlightedCommentId === comment.id"
              @reply="onReply"
              @reaction-toggle="onReactionToggle"
            />
          </template>
          <ThreadStageEvent
            v-else-if="unit.item.type === 'stage_event'"
            :event="unit.item.event"
          />
          <ApplicationCommentItem
            v-else
            :application-id="applicationId"
            :comment="unit.item.comment"
            :current-user-id="currentUserId"
            :can-delete-any="canDeleteAny"
            :can-reply="!readOnly"
            :read-only="readOnly"
            :is-first-in-group="true"
            :is-last-in-group="true"
            :highlighted="highlightedCommentId === unit.item.comment.id"
            :class="unit.item.comment.parentCommentId ? 'ml-7 border-l-2 border-surface-200 dark:border-surface-700 pl-2' : ''"
            @reply="onReply"
            @reaction-toggle="onReactionToggle"
          />
        </template>
      </div>
      <!-- Read receipts -->
      <ReadReceipts :application-id="applicationId" />
    </div>

    <!-- Scroll-to-bottom FAB -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <UiButton
        v-if="showJumpFab"
        size="sm"
        icon-only
        :icon-left="ArrowDown"
        class="absolute right-4 bottom-20 z-10 rounded-full shadow-lg"
        :title="t('comments.scroll_to_bottom')"
        @click="scrollToBottom()"
      />
    </Transition>

    <!-- Composer / read-only banner -->
    <div
      class="border-t border-surface-100 dark:border-surface-800"
      :class="compact ? 'px-3 py-2' : 'px-4 py-3'"
    >
      <div
        v-if="readOnly"
        class="flex items-center gap-2 rounded-lg border border-dashed border-danger-300 dark:border-danger-800/60 bg-danger-50/60 dark:bg-danger-900/10 px-3 py-2.5 text-xs text-danger-700 dark:text-danger-300"
      >
        <Eye class="size-3.5 flex-shrink-0" />
        <span>{{ t('comments.read_only_other_application') }}</span>
      </div>
      <template v-else>
        <!-- Typing indicator -->
        <div v-if="typingUsers.length > 0" class="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-surface-400">
          <span class="inline-flex gap-0.5">
            <span class="size-1 rounded-full bg-brand-400 animate-bounce" style="animation-delay: 0ms" />
            <span class="size-1 rounded-full bg-brand-400 animate-bounce" style="animation-delay: 150ms" />
            <span class="size-1 rounded-full bg-brand-400 animate-bounce" style="animation-delay: 300ms" />
          </span>
          <span>{{ typingUsers.map(u => u.name).join(', ') }} {{ t('comments.typing') }}</span>
        </div>
        <!-- Smart suggestions -->
        <SmartSuggestions
          :application-id="applicationId"
          @insert="(text) => composerRef?.insertText(text)"
        />
        <!-- Compact attach toolbar -->
        <div class="mb-2 flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] text-surface-400">{{ t('comment_snapshot.attach_label') }}:</span>
          <button
            type="button"
            :disabled="pinning"
            class="inline-flex items-center gap-1 rounded-md border border-accent-200 dark:border-accent-800/60 bg-accent-50/50 dark:bg-accent-900/10 px-2 py-1 text-[11px] font-medium text-accent-700 dark:text-accent-300 hover:bg-accent-100 dark:hover:bg-accent-900/30 disabled:opacity-50 cursor-pointer transition-colors"
            @click="onAttachSnapshot('ai_screening_snapshot')"
          >
            <Bot class="size-3" />
            {{ t('discussion_widgets.screening') }}
          </button>
          <button
            type="button"
            :disabled="pinning"
            class="inline-flex items-center gap-1 rounded-md border border-warning-200 dark:border-warning-800/60 bg-warning-50/50 dark:bg-warning-900/10 px-2 py-1 text-[11px] font-medium text-warning-700 dark:text-warning-300 hover:bg-warning-100 dark:hover:bg-warning-900/30 disabled:opacity-50 cursor-pointer transition-colors"
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
  </section>
</template>
