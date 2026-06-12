<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Lock, MoreVertical, Pencil, Trash2, MessageSquare } from 'lucide-vue-next'
import type { ThreadComment } from '~/composables/useApplicationComments'
import { useApplicationComments } from '~/composables/useApplicationComments'

const props = defineProps<{
  applicationId: string
  comment: ThreadComment
  currentUserId: string
  canDeleteAny: boolean
  canReply?: boolean
}>()

const emit = defineEmits<{
  reply: [parentCommentId: string]
}>()

const { t, locale } = useI18n()
const { updateComment, deleteComment } = useApplicationComments(props.applicationId)
const { ask } = useConfirm()

const isEditing = ref(false)
const editBody = ref(props.comment.body)
const saving = ref(false)
const menuOpen = ref(false)

const isAuthor = computed(() => props.comment.author.id === props.currentUserId)
const canEdit = computed(() => isAuthor.value)
const canDelete = computed(() => isAuthor.value || props.canDeleteAny)

const initial = computed(() => (props.comment.author.name ?? props.comment.author.email ?? '?').slice(0, 1).toUpperCase())

function formatDate(d: string | Date) {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

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
    class="group flex gap-3 rounded-lg px-3 py-3 transition-colors"
    :class="comment.isInternal
      ? 'bg-amber-50/60 dark:bg-amber-900/10 ring-1 ring-amber-200/60 dark:ring-amber-800/30'
      : 'hover:bg-surface-50 dark:hover:bg-surface-900/50'"
  >
    <!-- Avatar -->
    <div class="flex-shrink-0">
      <div class="flex h-8 w-8 items-center justify-center rounded-full bg-surface-200 dark:bg-surface-700 text-xs font-semibold text-surface-700 dark:text-surface-200">
        <img v-if="comment.author.image" :src="comment.author.image" :alt="comment.author.name ?? ''" class="h-8 w-8 rounded-full">
        <span v-else>{{ initial }}</span>
      </div>
    </div>

    <!-- Body -->
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2 mb-0.5">
        <span class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ comment.author.name || comment.author.email }}</span>
        <span class="text-xs text-surface-500">{{ formatDate(comment.createdAt) }}</span>
        <span v-if="comment.editedAt" class="text-xs text-surface-400">· {{ t('comments.edited') }}</span>
        <span
          v-if="comment.isInternal"
          class="inline-flex items-center gap-1 rounded-md bg-amber-200/70 dark:bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-200"
          :title="t('comments.internal_badge_hint')"
        >
          <Lock class="size-3" /> {{ t('comments.internal') }}
        </span>

        <!-- Actions -->
        <div ref="menuRoot" class="ml-auto relative">
          <button
            v-if="canEdit || canDelete"
            type="button"
            class="cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-surface-200 dark:hover:bg-surface-700"
            @click="menuOpen = !menuOpen"
          >
            <MoreVertical class="size-4 text-surface-500" />
          </button>
          <div
            v-if="menuOpen"
            class="absolute right-0 top-7 z-30 w-40 rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg py-1"
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
              class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              @click="menuOpen = false; onDelete()"
            >
              <Trash2 class="size-3.5" /> {{ t('comments.delete') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Editor -->
      <div v-if="isEditing" class="mt-1">
        <textarea
          v-model="editBody"
          rows="3"
          class="w-full rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div class="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            :disabled="!editBody.trim() || saving"
            class="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 cursor-pointer"
            @click="saveEdit"
          >
            {{ saving ? t('comments.saving') : t('comments.save') }}
          </button>
          <button
            type="button"
            class="rounded-md border border-surface-300 dark:border-surface-700 px-2.5 py-1 text-xs text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 cursor-pointer"
            @click="isEditing = false"
          >
            {{ t('comments.cancel') }}
          </button>
        </div>
      </div>

      <!-- Rendered body -->
      <div
        v-else
        class="prose prose-sm dark:prose-invert max-w-none text-sm text-surface-800 dark:text-surface-200 break-words [&_.mention]:bg-brand-100 [&_.mention]:dark:bg-brand-900/40 [&_.mention]:text-brand-700 [&_.mention]:dark:text-brand-300 [&_.mention]:rounded [&_.mention]:px-1 [&_.mention]:font-medium [&_a]:text-brand-600 [&_a]:dark:text-brand-400 [&_a]:underline"
        v-html="comment.bodyHtml || comment.body"
      />
    </div>
  </div>
</template>
