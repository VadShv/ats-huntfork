<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { Lock, MoreVertical, Pencil, Trash2, MessageSquare, Sparkles, Link2, Pin, ArrowRight, Reply, SmilePlus } from 'lucide-vue-next'
import { REACTION_EMOJI_SET, QUICK_REACTION_EMOJI } from '~/composables/useReactionEmojis'
import type { ThreadComment, StageCommentPayload } from '~/composables/useApplicationComments'
import { useApplicationComments } from '~/composables/useApplicationComments'
import { authorHue } from '~/composables/useDiscussionColors'
import CommentSnapshotWidget from './CommentSnapshotWidget.vue'
import CommentReactions from './CommentReactions.vue'
import AttachmentPreview from './AttachmentPreview.vue'

const props = withDefaults(defineProps<{
  applicationId: string
  comment: ThreadComment
  currentUserId: string
  canDeleteAny: boolean
  canReply?: boolean
  /** Collaboration Hub: тред чужого отклика — только просмотр. */
  readOnly?: boolean
  /** Grouping: первый комментарий в группе — показываем аватар/имя/время. */
  isFirstInGroup?: boolean
  /** Grouping: последний в группе — отступ снизу. */
  isLastInGroup?: boolean
  /** Deep-link / keyboard nav highlight. */
  highlighted?: boolean
  /** Родительское сообщение (для цитаты в ответе); null — родитель не найден/удалён. */
  parent?: ThreadComment | null
  /** Внешний запрос на правку (↑ в пустом композере): меняется число — открываем редактор. */
  editRequest?: number
}>(), {
  parent: null,
  editRequest: 0,
  canReply: false,
  readOnly: false,
  isFirstInGroup: true,
  isLastInGroup: true,
  highlighted: false,
})

const emit = defineEmits<{
  reply: [parentCommentId: string]
  reactionToggle: [commentId: string, emoji: string]
  /** Перейти к сообщению (клик по цитате ответа). */
  goto: [commentId: string]
  /** Редактор закрыт (сохранено или отменено) — после внешнего editRequest. */
  editEnd: []
}>()

const { t, locale } = useI18n()
const { updateComment, deleteComment, deleteAttachment, fetchComments, togglePin: togglePinRequest } = useApplicationComments(props.applicationId)
const { ask } = useConfirm()
const toast = useToast()
const route = useRoute()

const isEditing = ref(false)
/** Быстрая реакция из действий по наведению (когда под сообщением ещё нет чипов). */
const reactionPickerOpen = ref(false)
const editBody = ref(props.comment.body)
const saving = ref(false)
const menuOpen = ref(false)
const pinning = ref(false)

const hhBadge = computed(() => {
  const s = props.comment.hhSyncStatus
  if (!s || s === 'local') return null
  if (s === 'synced') {
    return props.comment.hhDirection === 'incoming'
      ? { tone: 'info', text: 'hh.ru ←' }
      : { tone: 'info', text: 'hh.ru ✓' }
  }
  if (s === 'pending') return { tone: 'warning', text: 'ожидает hh' }
  if (s === 'failed') return { tone: 'danger', text: 'ошибка hh' }
  return null
})

/** Закрепить: 'all' — для всех участников, 'me' — только для себя (личная полоса). */
async function togglePin(scope: 'all' | 'me') {
  if (pinning.value) return
  pinning.value = true
  try {
    await togglePinRequest(props.comment.id, scope)
  } catch {
    // тост показан в composable
  } finally {
    pinning.value = false
    menuOpen.value = false
  }
}

async function copyLink() {
  const url = `${window.location.origin}${route.path}#comment-${props.comment.id}`
  try {
    await navigator.clipboard.writeText(url)
    toast.success(t('comments.link_copied'))
  } catch {
    toast.error(t('comments.link_copied'))
  }
  menuOpen.value = false
}

/** Сообщение — один стикер без текста: без плашки, крупнее. */
const isStickerOnly = computed(() => /^\s*:sticker\[[a-z0-9_]{1,40}\]:\s*$/.test(props.comment.body ?? ''))

const isSnapshot = computed(() =>
  props.comment.kind === 'ai_screening_snapshot' || props.comment.kind === 'risk_snapshot',
)
const isAiResponse = computed(() => props.comment.kind === 'ai_response')
/** Сообщение, отправленное вместе со сменой этапа (новая оболочка). */
const isStageComment = computed(() => props.comment.kind === 'stage_comment')
const stagePayload = computed<StageCommentPayload | null>(() =>
  isStageComment.value ? (props.comment.payloadJson as StageCommentPayload | null) : null,
)
const stageTargetName = computed(() => {
  const p = stagePayload.value
  if (!p) return ''
  return p.toParentStageName ? `${p.toParentStageName} / ${p.toStageName}` : p.toStageName
})
/** Цитата родителя для ответа. */
const parentPreview = computed(() => {
  const parent = props.parent
  if (!props.comment.parentCommentId) return null
  if (!parent) return { author: '', text: t('comments.parent_unavailable') }
  const author = parent.kind === 'ai_response'
    ? t('comments.ai_assistant')
    : parent.hhDirection === 'incoming' && parent.hhAuthorName
      ? parent.hhAuthorName
      : (parent.author.name || parent.author.email || '—')
  const text = parent.body.replace(/\s+/g, ' ').trim()
  return { author, text: text.length > 140 ? `${text.slice(0, 140)}…` : text }
})
const isSelf = computed(() => props.comment.author.id === props.currentUserId)
const isAuthor = computed(() => props.comment.author.id === props.currentUserId)
const isHhIncoming = computed(() => props.comment.hhDirection === 'incoming')
// Снимки и AI-ответы нельзя редактировать (зафиксированные данные), но можно удалить.
const canEdit = computed(() => !props.readOnly && !isSnapshot.value && !isAiResponse.value && !isHhIncoming.value && isAuthor.value)

// ↑ в пустом композере: открыть правку этого сообщения и поставить курсор в конец
const editTextareaRef = ref<HTMLTextAreaElement | null>(null)
watch(() => props.editRequest, (v) => {
  if (!v || !canEdit.value) return
  isEditing.value = true
  editBody.value = props.comment.body
  nextTick(() => {
    const ta = editTextareaRef.value
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  })
})
watch(isEditing, (v, prev) => { if (prev && !v) emit('editEnd') })
const canDelete = computed(() => !props.readOnly && !isHhIncoming.value && (isAuthor.value || props.canDeleteAny))

/** Инициалы: две буквы имени и фамилии, иначе первые две буквы. */
const initial = computed(() => {
  const src = (props.comment.author.name ?? props.comment.author.email ?? '?').trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
  return src.slice(0, 2).toUpperCase()
})
/** Оттенок автора (визуальная версия 1): один цвет на человека во всех тредах. */
const hue = computed(() => authorHue(props.comment.author.id))
const parentHue = computed(() => authorHue(props.parent?.author.id))
const displayName = computed(() => {
  if (isAiResponse.value) return t('comments.ai_assistant')
  // Комментарий с hh.ru: автором показываем того, кто оставил его на hh (бейдж «hh.ru ←» рядом).
  if (isHhIncoming.value) return props.comment.hhAuthorName || 'hh.ru'
  return props.comment.author.name || props.comment.author.email
})

function formatDate(d: string | Date) {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    hour: '2-digit', minute: '2-digit',
  })
}

function formatSmartDate(d: string | Date) {
  const date = typeof d === 'string' ? new Date(d) : d
  const now = new Date()
  const loc = locale.value === 'ru' ? 'ru-RU' : 'en-US'
  const time = date.toLocaleString(loc, { hour: '2-digit', minute: '2-digit' })
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) return time
  const weekAgo = new Date(now)
  weekAgo.setDate(weekAgo.getDate() - 7)
  if (date > weekAgo) {
    const weekday = date.toLocaleString(loc, { weekday: 'short' })
    return `${weekday} ${time}`
  }
  return `${date.toLocaleString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' })} ${time}`
}

const displayDate = computed(() => {
  if (isHhIncoming.value && props.comment.hhSyncedAt) {
    return formatSmartDate(props.comment.hhSyncedAt)
  }
  return formatDate(props.comment.createdAt)
})

async function saveEdit() {
  if (!editBody.value.trim() || saving.value) return
  saving.value = true
  try {
    await updateComment(props.comment.id, editBody.value.trim())
    isEditing.value = false
  } finally {
    saving.value = false
  }
}

async function onDelete() {
  const ok = await ask({
    title: t('comments.delete_title'),
    message: t('comments.delete_message'),
    confirmLabel: t('comments.delete'),
    cancelLabel: t('comments.cancel'),
    variant: 'danger',
  })
  if (!ok) return
  await deleteComment(props.comment.id)
}

// Manual click-outside for the dropdown menu
const menuRoot = ref<HTMLElement | null>(null)
function handleDocClick(e: MouseEvent) {
  if (!menuOpen.value && !reactionPickerOpen.value) return
  if (menuRoot.value && !menuRoot.value.contains(e.target as Node)) {
    menuOpen.value = false
    reactionPickerOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', handleDocClick))
onBeforeUnmount(() => document.removeEventListener('click', handleDocClick))
</script>

<template>
  <div
    :id="`comment-${comment.id}`"
    class="group relative z-[1] flex gap-2.5 transition-colors disc-rise"
    :class="[
      isLastInGroup ? 'mb-3' : 'mb-0.5',
      isFirstInGroup ? 'mt-1' : '',
      highlighted ? 'ring-2 ring-brand-400 rounded-lg -mx-1 px-1 py-0.5' : '',
    ]"
    :style="{ '--h': hue }"
  >
    <!-- Аватар на рельсе (только первый в группе, иначе отступ) -->
    <div class="flex-shrink-0 w-7 flex justify-center self-start">
      <template v-if="isFirstInGroup">
        <!-- Ответ ИИ: искра на бирюзовом — единый язык ИИ -->
        <div
          v-if="isAiResponse"
          class="grid size-7 place-items-center rounded-full bg-gradient-to-br from-accent-400 to-accent-600 text-white ring-2 ring-white dark:ring-surface-900"
          :title="t('comments.ai_assistant')"
        >
          <Sparkles class="size-3.5" />
        </div>
        <!-- Комментарий с hh.ru -->
        <div
          v-else-if="isHhIncoming"
          class="grid size-7 place-items-center rounded-full bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-200 ring-2 ring-white dark:ring-surface-900 text-[9px] font-bold"
          title="hh.ru"
        >
          hh
        </div>
        <!-- Человек: градиент по оттенку автора -->
        <div
          v-else
          class="disc-avatar grid size-7 place-items-center rounded-full text-[10px] font-semibold"
          :title="comment.author.name ?? comment.author.email ?? ''"
        >
          <img v-if="comment.author.image" :src="comment.author.image" :alt="comment.author.name ?? ''" class="size-7 rounded-full object-cover">
          <span v-else>{{ initial }}</span>
        </div>
      </template>
    </div>

    <!-- Body -->
    <div class="min-w-0 flex-1 relative">
      <!-- Событие этапа, к которому прикреплено сообщение -->
      <div
        v-if="isStageComment && stagePayload"
        class="mb-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-100 dark:bg-surface-800 px-2.5 py-0.5 text-[11px] text-surface-600 dark:text-surface-300"
      >
        <ArrowRight class="size-3 flex-shrink-0" :style="{ color: stagePayload.toStageColor ?? 'var(--color-brand-500)' }" />
        <span class="truncate">
          {{ t('comments.moved_to_stage') }}
          <span class="inline-block size-1.5 rounded-full align-middle" :style="{ backgroundColor: stagePayload.toStageColor ?? '#94a3b8' }" />
          <span class="font-semibold text-surface-700 dark:text-surface-200">{{ stageTargetName }}</span>
          <template v-if="stagePayload.fromStageName"> <span class="text-surface-400">({{ t('comments.from_stage') }} {{ stagePayload.fromStageName }})</span></template>
        </span>
      </div>
      <!-- Meta (только первый в группе) -->
      <div v-if="isFirstInGroup" class="flex items-center gap-1.5 mb-0.5 pr-6">
        <span
          class="text-xs font-semibold"
          :class="isAiResponse
            ? 'text-accent-700 dark:text-accent-300'
            : isHhIncoming
              ? 'text-surface-700 dark:text-surface-200'
              : 'disc-author'"
        >
          {{ displayName }}
        </span>
        <span v-if="isSelf && !isAiResponse" class="text-[10px] text-surface-400">· {{ t('comments.you') }}</span>
        <span class="text-[10px] text-surface-400 font-mono">{{ displayDate }}</span>
        <span v-if="comment.editedAt" class="text-[10px] text-surface-400">· {{ t('comments.edited') }}</span>
        <span
          v-if="comment.isPinned"
          class="inline-flex items-center gap-0.5 rounded bg-brand-100 dark:bg-brand-900/40 px-1 py-0.5 text-[9px] font-medium text-brand-700 dark:text-brand-300"
        >
          <Pin class="size-2.5" /> {{ t('comments.pinned_badge') }}
        </span>
        <span
          v-else-if="comment.isPinnedByMe"
          class="inline-flex items-center gap-0.5 rounded bg-surface-100 dark:bg-surface-800 px-1 py-0.5 text-[9px] font-medium text-surface-600 dark:text-surface-300"
          :title="t('comments.pinned_for_me_hint')"
        >
          <Pin class="size-2.5" /> {{ t('comments.pinned_for_me_badge') }}
        </span>
        <span
          v-if="comment.isInternal"
          class="inline-flex items-center gap-0.5 text-[10px] font-medium text-warning-700 dark:text-warning-300"
          :title="t('comments.internal_badge_hint')"
        >
          <Lock class="size-2.5" /> {{ t('comments.internal') }}
        </span>
        <span
          v-if="hhBadge"
          class="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium"
          :class="hhBadge.tone === 'info'
            ? 'bg-info-100 dark:bg-info-900/40 text-info-700 dark:text-info-300'
            : hhBadge.tone === 'warning'
              ? 'bg-warning-100 dark:bg-warning-900/50 text-warning-800 dark:text-warning-200'
              : 'bg-danger-100 dark:bg-danger-900/40 text-danger-700 dark:text-danger-300'"
        >
          {{ hhBadge.text }}
        </span>
      </div>

      <!-- Действия по наведению: реакция · «⋯» (для каждого сообщения, не только первого в группе) -->
      <div
        v-if="canEdit || canDelete || canReply || !readOnly"
        ref="menuRoot"
        class="absolute right-0 top-0 z-20 flex items-center gap-0.5 rounded-md bg-white/90 dark:bg-surface-900/90 px-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
        :class="menuOpen || reactionPickerOpen ? '!opacity-100' : ''"
      >
        <!-- Быстрые реакции (C5): четыре одним кликом, остальные — палитра -->
        <template v-if="!readOnly">
          <button
            v-for="emoji in QUICK_REACTION_EMOJI"
            :key="emoji"
            type="button"
            class="cursor-pointer rounded px-0.5 text-[13px] leading-5 hover:bg-surface-200 dark:hover:bg-surface-700 hover:scale-110 transition-transform"
            :title="emoji"
            @click="emit('reactionToggle', comment.id, emoji)"
          >
            {{ emoji }}
          </button>
          <button
            type="button"
            class="cursor-pointer rounded p-0.5 hover:bg-surface-200 dark:hover:bg-surface-700"
            :title="t('reactions.add')"
            :aria-label="t('reactions.add')"
            @click="reactionPickerOpen = !reactionPickerOpen; menuOpen = false"
          >
            <SmilePlus class="size-3.5 text-surface-400" />
          </button>
        </template>
        <div
          v-if="reactionPickerOpen"
          class="absolute right-0 top-6 z-30 flex items-center gap-0.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-1.5 py-1 shadow-lg"
        >
          <button
            v-for="emoji in REACTION_EMOJI_SET.filter(e => !(QUICK_REACTION_EMOJI as readonly string[]).includes(e))"
            :key="emoji"
            type="button"
            class="inline-flex size-7 items-center justify-center rounded-md text-base hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer"
            :title="emoji"
            @click="reactionPickerOpen = false; emit('reactionToggle', comment.id, emoji)"
          >
            {{ emoji }}
          </button>
        </div>
        <button
          v-if="canEdit || canDelete || canReply"
          type="button"
          class="cursor-pointer rounded p-0.5 hover:bg-surface-200 dark:hover:bg-surface-700"
          :aria-label="t('comments.more')"
          @click="menuOpen = !menuOpen; reactionPickerOpen = false"
        >
          <MoreVertical class="size-3.5 text-surface-400" />
        </button>
        <div
          v-if="menuOpen"
          class="absolute right-0 top-6 z-30 w-40 rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg py-1"
        >
          <button
            v-if="canReply"
            type="button"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-100 dark:hover:bg-surface-800"
            @click="menuOpen = false; emit('reply', comment.id)"
          >
            <MessageSquare class="size-3.5" /> {{ t('comments.reply') }}
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-100 dark:hover:bg-surface-800"
            @click="copyLink"
          >
            <Link2 class="size-3.5" /> {{ t('comments.copy_link') }}
          </button>
          <button
            v-if="!readOnly"
            type="button"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-100 dark:hover:bg-surface-800"
            @click="togglePin('all')"
          >
            <Pin class="size-3.5" /> {{ comment.isPinned ? t('comments.unpin_for_all') : t('comments.pin_for_all') }}
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-100 dark:hover:bg-surface-800"
            @click="togglePin('me')"
          >
            <Pin class="size-3.5" /> {{ comment.isPinnedByMe ? t('comments.unpin_for_me') : t('comments.pin_for_me') }}
          </button>
          <button
            v-if="canEdit"
            type="button"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-100 dark:hover:bg-surface-800"
            @click="menuOpen = false; isEditing = true; editBody = comment.body"
          >
            <Pencil class="size-3.5" /> {{ t('comments.edit') }}
          </button>
          <button
            v-if="canDelete"
            type="button"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-900/20"
            @click="menuOpen = false; onDelete()"
          >
            <Trash2 class="size-3.5" /> {{ t('comments.delete') }}
          </button>
        </div>
      </div>

      <!-- Editor -->
      <div v-if="isEditing" class="mt-1">
        <textarea
          ref="editTextareaRef"
          v-model="editBody"
          rows="3"
          @keydown.esc.prevent="isEditing = false"
          @keydown.ctrl.enter.prevent="saveEdit"
          @keydown.meta.enter.prevent="saveEdit"
          class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div class="mt-1.5 flex items-center gap-2">
          <UiButton
            size="xs"
            :loading="saving"
            :disabled="!editBody.trim()"
            @click="saveEdit"
          >
            {{ saving ? t('comments.saving') : t('comments.save') }}
          </UiButton>
          <UiButton
            variant="secondary"
            size="xs"
            @click="isEditing = false"
          >
            {{ t('comments.cancel') }}
          </UiButton>
        </div>
      </div>

      <!-- Bubble -->
      <!--
        Пузырь. Нейтральный — светлая плашка; своё — лёгкий брендовый; внутреннее — янтарная
        кромка слева вместо сплошной заливки (§3.5); ответ ИИ — бирюзовая кромка (§3.6).
      -->
      <div
        v-else
        class="max-w-[68ch] px-3 py-2 text-sm leading-relaxed text-surface-800 dark:text-surface-200"
        :class="[
          isStickerOnly && !parentPreview
            ? 'bg-transparent px-0 py-0 [&_.sticker]:!h-28 [&_.sticker]:!w-28'
            : (isAiResponse || comment.kind === 'ai_screening_snapshot')
            ? 'rounded-r-xl rounded-l-md border-l-[3px] border-accent-500 bg-accent-50/70 dark:bg-accent-900/15'
            : comment.kind === 'risk_snapshot'
              ? 'rounded-r-xl rounded-l-md border-l-[3px] border-warning-500 bg-warning-50/70 dark:bg-warning-900/15'
            : comment.isInternal
              ? 'rounded-r-xl rounded-l-md border-l-[3px] border-warning-500 bg-warning-50/70 dark:bg-warning-900/15'
              : isSelf
                ? 'rounded-xl bg-brand-50 dark:bg-brand-900/25 text-brand-950 dark:text-brand-50'
                : 'rounded-xl bg-surface-100/80 dark:bg-surface-800/70',
        ]"
      >
        <!-- Цитата родителя (ответ) -->
        <button
          v-if="parentPreview"
          type="button"
          class="disc-quote mb-1.5 flex w-full items-start gap-2 rounded-r-md bg-white/70 dark:bg-surface-900/50 px-2 py-1 text-left cursor-pointer hover:bg-white dark:hover:bg-surface-900/80 transition-colors"
          :style="{ '--h': parentHue }"
          :disabled="!parent"
          :title="parent ? t('comments.goto_parent') : undefined"
          @click="parent && emit('goto', parent.id)"
        >
          <Reply class="mt-0.5 size-3 flex-shrink-0 text-surface-400" />
          <span class="min-w-0">
            <span v-if="parentPreview.author" class="disc-author block text-[11px] font-semibold">{{ parentPreview.author }}</span>
            <span class="block truncate text-[11px] text-surface-500 dark:text-surface-400">{{ parentPreview.text }}</span>
          </span>
        </button>

        <!-- Прикреплённый снимок ИИ -->
        <CommentSnapshotWidget
          v-if="isSnapshot"
          :comment="comment"
        />

        <!-- Rendered body -->
        <div
          v-else
          class="disc-body prose prose-sm dark:prose-invert max-w-none break-words [&_.mention]:bg-brand-100 [&_.mention]:dark:bg-brand-900/40 [&_.mention]:text-brand-700 [&_.mention]:dark:text-brand-300 [&_.mention]:rounded [&_.mention]:px-1 [&_.mention]:font-medium [&_a]:text-brand-600 [&_a]:dark:text-brand-400 [&_a]:underline [&_.sticker]:inline-block [&_.sticker]:my-1 [&_.sticker]:h-20 [&_.sticker]:w-20 [&_.sticker]:object-contain [&_.sticker]:rounded-md"
          v-html="comment.bodyHtml || comment.body"
        />
      </div>

      <!-- Attachments -->
      <div
        v-if="!isEditing && comment.attachments.length > 0"
        class="mt-1.5 flex flex-wrap gap-1.5"
      >
        <AttachmentPreview
          v-for="a in comment.attachments"
          :key="a.id"
          :application-id="applicationId"
          :comment-id="comment.id"
          :attachment="a"
          :can-delete="!readOnly && (isAuthor || canDeleteAny)"
          @remove="(aid: string) => deleteAttachment(comment.id, aid)"
        />
      </div>

      <!-- Reactions -->
      <CommentReactions
        v-if="!isEditing && comment.reactions.length > 0"
        :comment-id="comment.id"
        :reactions="comment.reactions"
        :current-user-id="currentUserId"
        :read-only="readOnly"
        @toggle="(cid: string, emoji: string) => emit('reactionToggle', cid, emoji)"
      />
    </div>
  </div>
</template>
