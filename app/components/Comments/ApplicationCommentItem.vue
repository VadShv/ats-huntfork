<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Lock, MoreVertical, Pencil, Trash2, MessageSquare, Bot, Link2, Pin, ArrowRight, Reply } from 'lucide-vue-next'
import type { ThreadComment, StageCommentPayload } from '~/composables/useApplicationComments'
import { useApplicationComments } from '~/composables/useApplicationComments'
import CommentSnapshotWidget from './CommentSnapshotWidget.vue'

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
}>(), {
  parent: null,
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
}>()

const { t, locale } = useI18n()
const { updateComment, deleteComment, deleteAttachment, fetchComments } = useApplicationComments(props.applicationId)
const { ask } = useConfirm()
const toast = useToast()
const route = useRoute()

const isEditing = ref(false)
const editBody = ref(props.comment.body)
const saving = ref(false)
const menuOpen = ref(false)
const pinning = ref(false)
const hhRetrying = ref(false)

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

async function retryHhSend() {
  if (hhRetrying.value) return
  hhRetrying.value = true
  try {
    await $fetch('/api/hh/comments/send', {
      method: 'POST',
      body: { commentId: props.comment.id },
    })
    toast.success('Сообщение отправлено на hh.ru')
    await fetchComments()
  } catch (e: any) {
    toast.error('Не удалось отправить', { message: e?.data?.statusMessage ?? e?.message })
  } finally {
    hhRetrying.value = false
  }
}

async function togglePin() {
  if (pinning.value) return
  pinning.value = true
  try {
    await $fetch(`/api/applications/${props.applicationId}/comments/${props.comment.id}/pin`, { method: 'POST' })
  } catch {
    toast.error('Не удалось закрепить сообщение')
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
const canDelete = computed(() => !props.readOnly && !isHhIncoming.value && (isAuthor.value || props.canDeleteAny))

const initial = computed(() => (props.comment.author.name ?? props.comment.author.email ?? '?').slice(0, 1).toUpperCase())
const displayName = computed(() => {
  if (isAiResponse.value) return t('comments.ai_assistant')
  if (isHhIncoming.value) return 'Система'
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
  if (!menuOpen.value) return
  if (menuRoot.value && !menuRoot.value.contains(e.target as Node)) {
    menuOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', handleDocClick))
onBeforeUnmount(() => document.removeEventListener('click', handleDocClick))
</script>

<template>
  <div
    :id="`comment-${comment.id}`"
    class="group flex gap-2.5 transition-colors"
    :class="[
      isLastInGroup ? 'mb-3' : 'mb-0.5',
      highlighted ? 'ring-2 ring-brand-400 rounded-lg -mx-1 px-1 py-0.5' : '',
    ]"
  >
    <!-- Avatar (только первый в группе, иначе spacer) -->
    <div class="flex-shrink-0 w-7 flex justify-center">
      <template v-if="isFirstInGroup">
        <!-- AI-ответ: bot-иконка (accent = AI) -->
        <div
          v-if="isAiResponse"
          class="grid size-7 place-items-center rounded-full bg-accent-100 dark:bg-accent-900/40 text-accent-600 dark:text-accent-400 ring-1 ring-accent-200 dark:ring-accent-800/60"
        >
          <Bot class="size-3.5" />
        </div>
        <!-- hh.ru import: hh-иконка -->
        <div
          v-else-if="isHhIncoming"
          class="grid size-7 place-items-center rounded-full bg-info-100 dark:bg-info-900/40 text-info-600 dark:text-info-400 ring-1 ring-info-200 dark:ring-info-800/60 text-[9px] font-bold"
        >
          hh
        </div>
        <!-- Обычный аватар -->
        <div
          v-else
          class="grid size-7 place-items-center rounded-full text-[10px] font-semibold"
          :class="isSelf
            ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-800/60'
            : 'bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-200'"
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
        <ArrowRight class="size-3 flex-shrink-0 text-brand-500" />
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
            : isSelf
              ? 'text-brand-700 dark:text-brand-300'
              : 'text-surface-900 dark:text-surface-100'"
        >
          {{ displayName }}
        </span>
        <span v-if="isHhIncoming && comment.hhAuthorName" class="text-[10px] text-surface-500 dark:text-surface-400">{{ comment.hhAuthorName }} ·</span>
        <span class="text-[10px] text-surface-400 font-mono">{{ displayDate }}</span>
        <span v-if="comment.editedAt" class="text-[10px] text-surface-400">· {{ t('comments.edited') }}</span>
        <span
          v-if="comment.isPinned"
          class="inline-flex items-center gap-0.5 rounded bg-brand-100 dark:bg-brand-900/40 px-1 py-0.5 text-[9px] font-medium text-brand-700 dark:text-brand-300"
        >
          <Pin class="size-2.5" /> {{ t('comments.pinned_badge') }}
        </span>
        <span
          v-if="comment.isInternal"
          class="inline-flex items-center gap-0.5 rounded bg-warning-100 dark:bg-warning-900/50 px-1 py-0.5 text-[9px] font-medium text-warning-800 dark:text-warning-200"
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
        <button
          v-if="hhBadge?.tone === 'danger' && !readOnly && !isHhIncoming"
          type="button"
          :disabled="hhRetrying"
          class="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 disabled:opacity-50 cursor-pointer"
          @click="retryHhSend"
        >
          {{ hhRetrying ? '…' : 'Повторить' }}
        </button>
      </div>

      <!-- Actions (для каждого сообщения, не только первого в группе) -->
      <div
        v-if="canEdit || canDelete || canReply"
        ref="menuRoot"
        class="absolute right-0 top-0 z-20"
      >
        <button
          type="button"
          class="cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 hover:bg-surface-200 dark:hover:bg-surface-700"
          :aria-label="t('comments.edit')"
          @click="menuOpen = !menuOpen"
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
            @click="togglePin"
          >
            <Pin class="size-3.5" /> {{ comment.isPinned ? t('comments.unpin') : t('comments.pin_for_all') }}
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
          v-model="editBody"
          rows="3"
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
      <div
        v-else
        class="rounded-2xl px-3 py-2 text-sm leading-relaxed"
        :class="[
          isAiResponse
            ? 'bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800/60 text-surface-800 dark:text-surface-200'
            : comment.isInternal
              ? 'bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800/60 text-surface-800 dark:text-surface-200'
              : isSelf
                ? 'bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800/60 text-brand-950 dark:text-brand-50'
                : 'bg-surface-50 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700 text-surface-800 dark:text-surface-200',
        ]"
      >
        <!-- Цитата родителя (ответ) -->
        <button
          v-if="parentPreview"
          type="button"
          class="mb-1.5 flex w-full items-start gap-2 rounded-r-md border-l-2 border-brand-500 bg-white/60 dark:bg-surface-900/40 px-2 py-1 text-left cursor-pointer hover:bg-white dark:hover:bg-surface-900/70 transition-colors"
          :disabled="!parent"
          :title="parent ? t('comments.goto_parent') : undefined"
          @click="parent && emit('goto', parent.id)"
        >
          <Reply class="mt-0.5 size-3 flex-shrink-0 text-brand-500" />
          <span class="min-w-0">
            <span v-if="parentPreview.author" class="block text-[11px] font-semibold text-brand-700 dark:text-brand-300">{{ parentPreview.author }}</span>
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
          class="prose prose-sm dark:prose-invert max-w-none break-words [&_.mention]:bg-brand-100 [&_.mention]:dark:bg-brand-900/40 [&_.mention]:text-brand-700 [&_.mention]:dark:text-brand-300 [&_.mention]:rounded [&_.mention]:px-1 [&_.mention]:font-medium [&_a]:text-brand-600 [&_a]:dark:text-brand-400 [&_a]:underline [&_.sticker]:inline-block [&_.sticker]:my-1 [&_.sticker]:h-20 [&_.sticker]:w-20 [&_.sticker]:object-contain [&_.sticker]:rounded-md"
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
          @remove="(aid) => deleteAttachment(comment.id, aid)"
        />
      </div>

      <!-- Reactions -->
      <CommentReactions
        v-if="!isEditing && (comment.reactions.length > 0 || !readOnly)"
        :comment-id="comment.id"
        :reactions="comment.reactions"
        :current-user-id="currentUserId"
        :read-only="readOnly"
        @toggle="(cid, emoji) => emit('reactionToggle', cid, emoji)"
      />
    </div>
  </div>
</template>
