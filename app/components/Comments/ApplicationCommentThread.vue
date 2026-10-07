<script setup lang="ts">
/**
 * «Обсуждение» отклика — новая оболочка (ТЗ docs/tz-discussion-shell.md).
 *
 * Шапка: заголовок · «видит команда» · [Другие отклики ▾] · поиск · «⋯».
 * Полоса закреплённого (DiscussionPinnedBar) · лента · композер.
 * Редкие действия — в «⋯» (участники, фильтры, hh.ru) и в «+» композера.
 */
import { onMounted, onBeforeUnmount, ref, computed, nextTick, watch } from 'vue'
import { MessageSquare, Users, Eye, ArrowDown, Search, RefreshCw, MoreHorizontal, X, ChevronDown, Check, Lock, Bot, ArrowRight, ArrowLeft } from 'lucide-vue-next'
import ApplicationCommentItem from './ApplicationCommentItem.vue'
import ApplicationCommentComposer from './ApplicationCommentComposer.vue'
import ThreadStageEvent from './ThreadStageEvent.vue'
import AiSummaryCard from './AiSummaryCard.vue'
import WatcherPanel from './WatcherPanel.vue'
import ReadReceipts from './ReadReceipts.vue'
import DiscussionPinnedBar from './DiscussionPinnedBar.vue'
import { useApplicationComments, type ThreadComment, type TimelineItem, type StageCommentPayload } from '~/composables/useApplicationComments'
import { groupTimeline, type RenderUnit } from '~/composables/useCommentGroups'
import { useThreadScroll } from '~/composables/useThreadScroll'
import { useThreadFilter, type ThreadFilter } from '~/composables/useThreadFilter'
import { useUnreadComments } from '~/composables/useUnreadComments'
import type { StageMoveResult } from '~/composables/useApplicationStages'
import { canSeeInternalRole } from '~~/shared/access/discussion'

/** Другой отклик кандидата — пункт выпадающего списка «Другие отклики». */
export interface DiscussionAppOption {
  id: string
  jobTitle: string | null
  stageName: string | null
  stageColor: string | null
  isTerminal: boolean
  commentCount: number
  unreadCount: number
  isCurrent: boolean
}

const props = withDefaults(
  defineProps<{
    applicationId: string
    /** Кандидат — для контекста ИИ (риск считается по кандидату). */
    candidateId?: string
    /** Компактный лейаут для шторки/сайдбара. */
    compact?: boolean
    /** Просмотр треда чужого отклика кандидата: без композера и действий. */
    readOnly?: boolean
    /** Отклик связан с hh.ru — пункт «Синхронизировать» в «⋯». */
    hhLinked?: boolean
    /** Отклики кандидата для переключателя «Другие отклики» (включая текущий). */
    applications?: DiscussionAppOption[]
  }>(),
  { candidateId: undefined, compact: false, readOnly: false, hhLinked: false, applications: () => [] },
)

const emit = defineEmits<{
  /** Пользователь выбрал другой отклик в переключателе. */
  switchApplication: [applicationId: string]
  /** Этап отклика изменён из композера — страница/шторка должны обновить данные отклика. */
  stageChanged: [payload: StageMoveResult]
  openScreening: []
  openRisk: []
}>()

const { t } = useI18n()
const { data: session } = await authClient.useSession(useFetch)
const currentUserId = computed(() => session.value?.user?.id ?? '')

const { role: currentMemberRole } = usePermissions()
const currentRole = computed<string>(() => currentMemberRole.value ?? '')

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
  searchMembers,
  summarize,
  typingUsers,
} = useApplicationComments(props.applicationId)

const toast = useToast()
const hhSyncing = ref(false)
const summarizing = ref(false)

async function onHhSync() {
  if (hhSyncing.value) return
  hhSyncing.value = true
  moreOpen.value = false
  try {
    const res = await $fetch<{ inboundCount: number, outboundCount: number, errors: string[] }>(
      '/api/hh/comments/sync',
      { method: 'POST', body: { applicationId: props.applicationId } },
    )
    const parts: string[] = []
    if (res.inboundCount > 0) parts.push(`получено ${res.inboundCount}`)
    if (res.outboundCount > 0) parts.push(`отправлено ${res.outboundCount}`)
    if (res.errors.length > 0) parts.push(`ошибок: ${res.errors.length}`)
    toast.success('Синхронизация hh.ru', parts.length > 0 ? parts.join(', ') : 'нет новых сообщений')
    await fetchComments()
  } catch (e: any) {
    toast.error('Не удалось синхронизировать', { message: e?.data?.statusMessage ?? e?.message })
  } finally {
    hhSyncing.value = false
  }
}

async function onSummarize() {
  if (summarizing.value) return
  summarizing.value = true
  try {
    await summarize()
    void fetchComments()
  } catch {
    // тост уже показан в composable
  } finally {
    summarizing.value = false
  }
}

function onReactionToggle(commentId: string, emoji: string) {
  if (props.readOnly) return
  void toggleReaction(commentId, emoji, currentUserId.value)
}

// Один источник правил видимости для клиента и сервера (shared/access/discussion.ts).
const canSeeInternal = computed(() => canSeeInternalRole(currentRole.value))
const canDeleteAny = computed(() => ['owner', 'admin'].includes(currentRole.value))

const composerRef = ref<InstanceType<typeof ApplicationCommentComposer> | null>(null)
const replyTo = ref<string | null>(null)
const highlightedCommentId = ref<string | null>(null)
const route = useRoute()

const commentsById = computed(() => {
  const map = new Map<string, ThreadComment>()
  for (const c of comments.value) map.set(c.id, c)
  return map
})

function authorLabel(c: ThreadComment): string {
  if (c.kind === 'ai_response') return t('comments.ai_assistant')
  if (c.hhDirection === 'incoming' && c.hhAuthorName) return c.hhAuthorName
  return c.author.name || c.author.email || '—'
}

const replyTarget = computed(() => {
  if (!replyTo.value) return null
  const c = commentsById.value.get(replyTo.value)
  if (!c) return null
  const preview = c.body.replace(/\s+/g, ' ').trim()
  return { id: c.id, author: authorLabel(c), preview: preview.length > 120 ? `${preview.slice(0, 120)}…` : preview }
})

let disconnectStream: (() => void) | null = null
let highlightTimer: ReturnType<typeof setTimeout> | null = null

function gotoComment(id: string) {
  highlightedCommentId.value = id
  nextTick(() => {
    const el = document.getElementById(`comment-${id}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (highlightTimer) clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => { highlightedCommentId.value = null }, 2000)
  })
}

onMounted(async () => {
  await Promise.all([fetchComments(), fetchWatchers(), fetchStageHistory()])
  disconnectStream = connectStream()
  const { markRead } = useUnreadComments()
  void markRead(props.applicationId)
  if (route.hash?.startsWith('#comment-')) {
    gotoComment(route.hash.slice('#comment-'.length))
  }
})
onBeforeUnmount(() => {
  disconnectStream?.()
  if (highlightTimer) clearTimeout(highlightTimer)
})

function onSubmitted() {
  replyTo.value = null
  void fetchComments()
}
function onCancelReply() { replyTo.value = null }
function onStageMoved(payload: StageMoveResult) {
  void fetchStageHistory()
  void fetchComments()
  emit('stageChanged', payload)
}
function onReply(parentId: string) {
  replyTo.value = parentId
  setTimeout(() => composerRef.value?.focus(), 50)
}

// ── Лента: скрываем событие этапа, парное к stage_comment (иначе дубль) ──
const PAIR_WINDOW_MS = 15_000
const timelineForGrouping = computed<TimelineItem[]>(() => {
  const stageComments = timeline.value
    .filter((i): i is Extract<TimelineItem, { type: 'comment' }> => i.type === 'comment' && i.comment.kind === 'stage_comment')
  if (stageComments.length === 0) return timeline.value
  return timeline.value.filter((item) => {
    if (item.type !== 'stage_event') return true
    const ev = item.event
    return !stageComments.some((sc) => {
      const p = sc.comment.payloadJson as StageCommentPayload | null
      if (!p) return false
      const sameStage = ev.toStageName === p.toStageName
      const movedAt = new Date(p.movedAt).getTime()
      return sameStage && Math.abs(new Date(ev.movedAt).getTime() - movedAt) < PAIR_WINDOW_MS
    })
  })
})
const renderUnits = computed<RenderUnit[]>(() => groupTimeline(timelineForGrouping.value, currentUserId.value))

// ── Фильтр (в строке поиска и в «⋯») ──
const { active: activeFilter, filtered: filteredUnits, counts: filterCounts } = useThreadFilter(renderUnits)
const quickFilters = ['internal', 'ai', 'events'] as const satisfies readonly ThreadFilter[]
function toggleFilter(f: ThreadFilter) {
  activeFilter.value = activeFilter.value === f ? 'all' : f
}

// ── Поиск по треду ──
const searchQuery = ref('')
const searchOpen = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)
const searchMatches = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return [] as string[]
  return comments.value.filter(c => c.body.toLowerCase().includes(q)).map(c => c.id)
})
const searchMatchIdx = ref(0)
watch(searchMatches, (list) => {
  searchMatchIdx.value = 0
  if (list.length > 0) gotoComment(list[0]!)
})
function openSearch() { searchOpen.value = true; nextTick(() => searchInputRef.value?.focus()) }
function closeSearch() { searchOpen.value = false; searchQuery.value = ''; activeFilter.value = 'all' }
function searchStep(dir: 1 | -1) {
  const n = searchMatches.value.length
  if (!n) return
  searchMatchIdx.value = (searchMatchIdx.value + dir + n) % n
  gotoComment(searchMatches.value[searchMatchIdx.value]!)
}

// ── Закреплённые ──
const pinnedComments = computed(() =>
  comments.value.filter(c => c.isPinned).sort((a, b) => new Date(b.pinnedAt ?? b.createdAt).getTime() - new Date(a.pinnedAt ?? a.createdAt).getTime()),
)

// ── Меню «⋯» и «Другие отклики» ──
const moreOpen = ref(false)
const moreRoot = ref<HTMLElement | null>(null)
const appsOpen = ref(false)
const appsRoot = ref<HTMLElement | null>(null)
const watchersOpen = ref(false)
const otherApps = computed(() => props.applications.filter(a => !a.isCurrent))
const currentApp = computed(() => props.applications.find(a => a.id === props.applicationId) ?? null)
const otherUnread = computed(() => otherApps.value.reduce((s, a) => s + a.unreadCount, 0))

function onDocClick(e: MouseEvent) {
  const target = e.target as Node
  if (moreOpen.value && moreRoot.value && !moreRoot.value.contains(target)) moreOpen.value = false
  if (appsOpen.value && appsRoot.value && !appsRoot.value.contains(target)) appsOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

function pickApplication(id: string) {
  appsOpen.value = false
  if (id !== props.applicationId) emit('switchApplication', id)
}
const currentOwnApplication = computed(() => props.applications.find(a => a.isCurrent) ?? null)

// ── Прокрутка ──
const scrollRef = ref<HTMLElement | null>(null)
const { showJumpFab, scrollToBottom } = useThreadScroll(scrollRef, computed(() => filteredUnits.value.length))

const menuItemClass = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer disabled:opacity-50'
const iconBtnClass = 'inline-flex size-7 items-center justify-center rounded-md text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-200 cursor-pointer transition-colors'
</script>

<template>
  <section
    class="relative flex flex-col rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden"
    :class="compact ? 'max-h-[640px]' : ''"
  >
    <!-- ── Шапка ── -->
    <header
      class="flex items-center gap-2 border-b border-surface-100 dark:border-surface-800"
      :class="compact ? 'px-3 py-2' : 'px-4 py-2.5'"
    >
      <MessageSquare class="size-4 flex-shrink-0 text-brand-500" />
      <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200">{{ t('comments.thread_title') }}</h2>
      <span class="hidden sm:inline text-[11px] text-surface-400">{{ t('comments.audience_team') }}</span>
      <span v-if="comments.length > 0" class="rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-xs tabular-nums text-surface-600 dark:text-surface-300">
        {{ comments.length }}
      </span>
      <span class="flex-1" />

      <!-- Другие отклики кандидата -->
      <div v-if="otherApps.length > 0" ref="appsRoot" class="relative">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/60 px-2.5 py-1 text-xs text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer transition-colors whitespace-nowrap"
          @click="appsOpen = !appsOpen; moreOpen = false"
        >
          <span class="hidden sm:inline">{{ t('comments.other_applications') }}</span>
          <span class="rounded-full bg-surface-300/70 dark:bg-surface-600 px-1.5 text-[10px] font-semibold tabular-nums text-surface-700 dark:text-surface-100">{{ otherApps.length }}</span>
          <span v-if="otherUnread > 0" class="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold tabular-nums text-white">{{ otherUnread }}</span>
          <ChevronDown class="size-3 text-surface-400" />
        </button>
        <div
          v-if="appsOpen"
          class="absolute right-0 top-full z-30 mt-1.5 w-80 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-1 shadow-lg"
        >
          <div class="px-2.5 pb-1 pt-1 text-[10px] uppercase tracking-wide text-surface-400">{{ t('comments.candidate_applications') }}</div>
          <button
            v-for="a in applications"
            :key="a.id"
            type="button"
            :class="menuItemClass"
            class="!items-start"
            @click="pickApplication(a.id)"
          >
            <span class="mt-1 size-2 flex-shrink-0 rounded-full" :style="{ backgroundColor: a.stageColor ?? '#94a3b8' }" />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium" :class="a.isTerminal ? 'text-surface-400 line-through decoration-1' : ''">
                {{ a.jobTitle || t('discussion_tabs.untitled_job') }}
              </span>
              <span class="block truncate text-[10px] text-surface-400">
                <template v-if="a.stageName">{{ a.stageName }} · </template>
                {{ t('comments.messages_n', { n: a.commentCount }) }}
                <template v-if="a.isCurrent"> · {{ t('discussion_tabs.current') }}</template>
                <template v-else> · {{ t('discussion_tabs.view_only') }}</template>
              </span>
            </span>
            <Check v-if="a.id === applicationId" class="mt-0.5 size-3.5 flex-shrink-0 text-brand-600" />
            <span v-else-if="a.unreadCount > 0" class="mt-0.5 rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold tabular-nums text-white">{{ a.unreadCount }}</span>
          </button>
        </div>
      </div>

      <!-- Поиск -->
      <button
        v-if="comments.length > 0"
        type="button"
        :class="[iconBtnClass, searchOpen ? 'bg-surface-100 dark:bg-surface-800 text-surface-700' : '']"
        :title="t('comments.search_placeholder')"
        @click="searchOpen ? closeSearch() : openSearch()"
      >
        <Search class="size-4" />
      </button>

      <!-- «⋯» -->
      <div ref="moreRoot" class="relative">
        <button type="button" :class="[iconBtnClass, moreOpen ? 'bg-surface-100 dark:bg-surface-800' : '']" :title="t('comments.more')" @click="moreOpen = !moreOpen; appsOpen = false">
          <MoreHorizontal class="size-4" />
        </button>
        <div
          v-if="moreOpen"
          class="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-1 shadow-lg"
        >
          <button type="button" :class="menuItemClass" @click="watchersOpen = !watchersOpen; moreOpen = false">
            <Users class="size-3.5 text-surface-400" />
            {{ t('comments.participants') }}
            <span class="ml-auto text-[10px] tabular-nums text-surface-400">{{ watchers.length }}</span>
          </button>
          <div class="my-1 h-px bg-surface-100 dark:bg-surface-800" />
          <div class="px-2.5 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-surface-400">{{ t('comments.feed_filter') }}</div>
          <button
            v-for="f in quickFilters"
            :key="f"
            type="button"
            :class="menuItemClass"
            @click="toggleFilter(f)"
          >
            <component :is="f === 'internal' ? Lock : f === 'ai' ? Bot : ArrowRight" class="size-3.5 text-surface-400" />
            {{ t(`comments.filter_only_${f}`) }}
            <span class="ml-auto flex items-center gap-1.5">
              <span class="text-[10px] tabular-nums text-surface-400">{{ filterCounts[f] }}</span>
              <span
                class="relative inline-block h-4 w-7 rounded-full transition-colors"
                :class="activeFilter === f ? 'bg-brand-600' : 'bg-surface-300 dark:bg-surface-600'"
              >
                <span class="absolute top-0.5 size-3 rounded-full bg-white transition-all" :class="activeFilter === f ? 'left-3.5' : 'left-0.5'" />
              </span>
            </span>
          </button>
          <template v-if="hhLinked && !readOnly">
            <div class="my-1 h-px bg-surface-100 dark:bg-surface-800" />
            <button type="button" :class="menuItemClass" :disabled="hhSyncing" @click="onHhSync">
              <RefreshCw class="size-3.5 text-surface-400" :class="hhSyncing ? 'animate-spin' : ''" />
              {{ t('comments.sync_hh') }}
            </button>
          </template>
        </div>
      </div>
    </header>

    <!-- Просмотр чужого отклика -->
    <div
      v-if="readOnly"
      class="flex items-center gap-2 border-b border-surface-100 dark:border-surface-800 bg-surface-50 dark:bg-surface-950/40 px-3 py-1.5 text-[11px] text-surface-600 dark:text-surface-300"
    >
      <Eye class="size-3.5 flex-shrink-0 text-surface-400" />
      <span class="truncate">
        {{ t('comments.viewing_label') }}
        <span class="font-medium">{{ currentApp?.jobTitle || t('discussion_tabs.untitled_job') }}</span>
        · {{ t('discussion_tabs.view_only') }}
      </span>
      <button
        v-if="currentOwnApplication"
        type="button"
        class="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/20 cursor-pointer whitespace-nowrap"
        @click="pickApplication(currentOwnApplication.id)"
      >
        <ArrowLeft class="size-3" /> {{ t('comments.back_to_current') }}
      </button>
    </div>

    <!-- Участники -->
    <WatcherPanel
      v-if="watchersOpen"
      :watchers="watchers"
      :search-members="searchMembers"
      :add-watcher="addWatcher"
      :remove-watcher="removeWatcher"
      :read-only="readOnly"
      :compact="compact"
    />

    <!-- Поиск + фильтры -->
    <div
      v-if="searchOpen"
      class="flex flex-wrap items-center gap-1.5 border-b border-surface-100 dark:border-surface-800 bg-surface-50 dark:bg-surface-950/40 px-3 py-1.5"
    >
      <Search class="size-3.5 flex-shrink-0 text-surface-400" />
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        type="text"
        :placeholder="t('comments.search_placeholder')"
        class="min-w-[140px] flex-1 bg-transparent text-xs text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none"
        @keydown.enter.prevent="searchStep(1)"
        @keydown.esc.prevent="closeSearch"
      >
      <button
        v-for="f in quickFilters"
        :key="f"
        type="button"
        class="rounded-full border px-2 py-0.5 text-[11px] transition-colors cursor-pointer"
        :class="activeFilter === f
          ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
          : 'border-surface-200 dark:border-surface-700 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800'"
        @click="toggleFilter(f)"
      >
        {{ t(`comments.filter_${f}`) }}
        <span v-if="filterCounts[f] > 0" class="ml-0.5 tabular-nums opacity-70">{{ filterCounts[f] }}</span>
      </button>
      <span v-if="searchQuery.trim()" class="text-[10px] tabular-nums text-surface-400">
        {{ searchMatches.length ? `${searchMatchIdx + 1}/${searchMatches.length}` : t('comments.search_none') }}
      </span>
      <button v-if="searchMatches.length > 1" type="button" class="rounded p-0.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 cursor-pointer" @click="searchStep(-1)">↑</button>
      <button v-if="searchMatches.length > 1" type="button" class="rounded p-0.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 cursor-pointer" @click="searchStep(1)">↓</button>
      <button type="button" class="rounded p-0.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 cursor-pointer" :title="t('comments.cancel')" @click="closeSearch">
        <X class="size-3.5" />
      </button>
    </div>

    <!-- Полоса закреплённого + контекст ИИ -->
    <DiscussionPinnedBar
      v-if="candidateId"
      :application-id="applicationId"
      :candidate-id="candidateId"
      :pinned-comments="pinnedComments"
      :compact="compact"
      @goto="gotoComment"
      @open-screening="emit('openScreening')"
      @open-risk="emit('openRisk')"
    />

    <!-- Лента -->
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto scrollbar-thin"
      :class="compact ? 'max-h-[420px] px-3 py-2' : 'max-h-[560px] px-4 py-3'"
    >
      <div v-if="loading && comments.length === 0" class="py-8 text-center text-sm text-surface-400">
        <span class="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-surface-300 border-t-brand-500 align-middle" />
        {{ t('comments.loading') }}
      </div>
      <div v-else-if="error" class="py-4 text-center text-sm text-danger-600 dark:text-danger-400">{{ error }}</div>
      <div v-else-if="timeline.length === 0" class="py-8 text-center text-sm text-surface-400">
        {{ t('comments.empty_new') }}
      </div>
      <div v-else-if="filteredUnits.length === 0" class="py-6 text-center text-xs text-surface-400">
        {{ t('comments.filter_empty') }}
        <button type="button" class="ml-1 text-brand-600 hover:underline cursor-pointer" @click="activeFilter = 'all'">{{ t('comments.filter_reset') }}</button>
      </div>
      <div v-else>
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
              @goto="gotoComment"
            />
          </template>
          <ThreadStageEvent
            v-else-if="unit.item.type === 'stage_event'"
            :event="unit.item.event"
          />
          <AiSummaryCard
            v-else-if="unit.item.comment.kind === 'ai_summary'"
            :comment="unit.item.comment"
            :can-refresh="!readOnly"
            class="mb-3"
            @refresh="onSummarize"
          />
          <ApplicationCommentItem
            v-else
            :application-id="applicationId"
            :comment="unit.item.comment"
            :parent="unit.item.comment.parentCommentId ? (commentsById.get(unit.item.comment.parentCommentId) ?? null) : null"
            :current-user-id="currentUserId"
            :can-delete-any="canDeleteAny"
            :can-reply="!readOnly"
            :read-only="readOnly"
            :is-first-in-group="true"
            :is-last-in-group="true"
            :highlighted="highlightedCommentId === unit.item.comment.id"
            @reply="onReply"
            @reaction-toggle="onReactionToggle"
            @goto="gotoComment"
          />
        </template>
      </div>
      <div class="flex justify-end">
        <ReadReceipts :application-id="applicationId" />
      </div>
    </div>

    <!-- Кнопка «вниз» -->
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

    <!-- Композер -->
    <div
      v-if="!readOnly"
      class="border-t border-surface-100 dark:border-surface-800"
      :class="compact ? 'px-3 py-2' : 'px-4 py-3'"
    >
      <ApplicationCommentComposer
        ref="composerRef"
        :application-id="applicationId"
        :can-mark-internal="canSeeInternal"
        :reply-to="replyTarget"
        :compact="compact"
        @submitted="onSubmitted"
        @cancel="onCancelReply"
        @stage-moved="onStageMoved"
      />
      <div class="mt-1 flex h-4 items-center gap-1.5 pl-10 text-[11px] text-surface-400">
        <template v-if="typingUsers.length > 0">
          <span class="inline-flex gap-0.5">
            <span class="size-1 animate-bounce rounded-full bg-brand-400" style="animation-delay: 0ms" />
            <span class="size-1 animate-bounce rounded-full bg-brand-400" style="animation-delay: 150ms" />
            <span class="size-1 animate-bounce rounded-full bg-brand-400" style="animation-delay: 300ms" />
          </span>
          <span>{{ typingUsers.map(u => u.name).join(', ') }} {{ t('comments.typing') }}</span>
        </template>
      </div>
    </div>
  </section>
</template>
