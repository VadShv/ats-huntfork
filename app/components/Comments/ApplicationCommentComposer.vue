<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { Send, Lock, Paperclip, X, File as FileIcon, Smile } from 'lucide-vue-next'
import ApplicationMentionAutocomplete from './ApplicationMentionAutocomplete.vue'
import StickerPicker from './StickerPicker.vue'
import { useApplicationComments, type OrgMember } from '~/composables/useApplicationComments'

const props = defineProps<{
  applicationId: string
  /** allow toggling is_internal — passed from parent (only visible if user has the role) */
  canMarkInternal?: boolean
  /** optional reply target (parent comment id) */
  parentCommentId?: string | null
  placeholder?: string
}>()

const emit = defineEmits<{
  submitted: []
  cancel: []
}>()

const { t } = useI18n()
const toast = useToast()
const { createComment, uploadAttachment, searchMembers } = useApplicationComments(props.applicationId)

const body = ref('')
const isInternal = ref(false)
const submitting = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingFiles = ref<File[]>([])
const isDragOver = ref(false)

const MAX_FILES = 10
const MAX_FILE_BYTES = 10 * 1024 * 1024

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function addFiles(list: FileList | File[] | null) {
  if (!list) return
  const incoming = Array.from(list)
  for (const f of incoming) {
    if (pendingFiles.value.length >= MAX_FILES) {
      toast.error('Достигнут лимит файлов', { message: `Максимум ${MAX_FILES} файлов на комментарий` })
      break
    }
    if (f.size > MAX_FILE_BYTES) {
      toast.error('Файл слишком большой', { message: `${f.name} — максимум 10 МБ` })
      continue
    }
    pendingFiles.value.push(f)
  }
}

function removeFile(idx: number) {
  pendingFiles.value.splice(idx, 1)
}

function onFilePick(e: Event) {
  const target = e.target as HTMLInputElement
  addFiles(target.files)
  // reset so re-picking the same file fires change
  target.value = ''
}

function onDragEnter(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = true
}
function onDragLeave(e: DragEvent) {
  e.preventDefault()
  // only clear when leaving the composer, not when crossing inner elements
  if (e.currentTarget === e.target) isDragOver.value = false
}
function onDragOver(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = true
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  if (e.dataTransfer?.files?.length) {
    addFiles(e.dataTransfer.files)
  }
}

// ── Mention autocomplete state ──
const mentionQuery = ref<string | null>(null)
const mentionPos = ref(0) // position of the @ in body
const memberCandidates = ref<OrgMember[]>([])
const activeMentionIdx = ref(0)
const showAutocomplete = computed(() => mentionQuery.value !== null && memberCandidates.value.length > 0)

let searchAbort: number | null = null
async function refreshMentionCandidates() {
  if (mentionQuery.value === null) {
    memberCandidates.value = []
    return
  }
  if (searchAbort) window.clearTimeout(searchAbort)
  const q = mentionQuery.value
  searchAbort = window.setTimeout(async () => {
    const list = await searchMembers(q)
    memberCandidates.value = list
    activeMentionIdx.value = 0
  }, 120)
}

function onInput(e: Event) {
  const ta = e.target as HTMLTextAreaElement
  const value = ta.value
  body.value = value
  const caret = ta.selectionStart ?? value.length
  // Find the @ token immediately before caret
  const before = value.slice(0, caret)
  const atIdx = before.lastIndexOf('@')
  if (atIdx < 0) {
    mentionQuery.value = null
    return
  }
  // must be at start or preceded by whitespace
  const prev = atIdx === 0 ? ' ' : before[atIdx - 1]
  if (!/\s/.test(prev) && atIdx !== 0) {
    mentionQuery.value = null
    return
  }
  const token = before.slice(atIdx + 1)
  // Stop autocomplete if the token contains a space (unless quoted) — keep it simple for MVP
  if (/\s/.test(token) && !token.startsWith('"')) {
    mentionQuery.value = null
    return
  }
  mentionQuery.value = token.replace(/^"/, '')
  mentionPos.value = atIdx
  refreshMentionCandidates()
}

function pickMember(m: OrgMember) {
  const ta = textareaRef.value
  if (!ta) return
  const before = body.value.slice(0, mentionPos.value)
  const after = body.value.slice(ta.selectionStart ?? body.value.length)
  // Use quoted form to preserve spaces in names
  const insert = m.name && /\s/.test(m.name) ? `@"${m.name}"` : `@${m.name ?? m.email?.split('@')[0] ?? ''}`
  body.value = `${before}${insert} ${after}`
  mentionQuery.value = null
  nextTick(() => {
    ta.focus()
    const newPos = before.length + insert.length + 1
    ta.setSelectionRange(newPos, newPos)
  })
}

function onKeydown(e: KeyboardEvent) {
  if (showAutocomplete.value) {
    if (e.key === 'ArrowDown') { activeMentionIdx.value = Math.min(activeMentionIdx.value + 1, memberCandidates.value.length - 1); e.preventDefault(); return }
    if (e.key === 'ArrowUp')   { activeMentionIdx.value = Math.max(activeMentionIdx.value - 1, 0); e.preventDefault(); return }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const m = memberCandidates.value[activeMentionIdx.value]
      if (m) { pickMember(m); e.preventDefault(); return }
    }
    if (e.key === 'Escape') { mentionQuery.value = null; e.preventDefault(); return }
  }
  // Ctrl/Cmd+Enter → submit
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    void submit()
  }
}

async function submit() {
  const trimmed = body.value.trim()
  if ((!trimmed && pendingFiles.value.length === 0) || submitting.value) return
  submitting.value = true
  try {
    // server requires body.min(1); when only files are attached, use a minimal default body
    const finalBody = trimmed.length > 0
      ? trimmed
      : (pendingFiles.value.length === 1 ? pendingFiles.value[0]!.name : t('attachments.files_attached', { n: pendingFiles.value.length }))

    const created = await createComment({
      body: finalBody,
      isInternal: isInternal.value,
      parentCommentId: props.parentCommentId ?? undefined,
    })
    if (created?.id && pendingFiles.value.length > 0) {
      // upload sequentially to keep ordering & avoid spike on the bucket
      for (const f of pendingFiles.value) {
        await uploadAttachment(created.id, f)
      }
    }
    body.value = ''
    isInternal.value = false
    pendingFiles.value = []
    emit('submitted')
  } catch {
    // toast already shown
  } finally {
    submitting.value = false
  }
}

function focus() {
  textareaRef.value?.focus()
}
defineExpose({ focus })

// ── Sticker picker ──
const showStickerPicker = ref(false)

function insertSticker(s: { id: string }) {
  const ta = textareaRef.value
  const token = `:sticker[${s.id}]:`
  if (!ta) {
    body.value = body.value ? `${body.value} ${token}` : token
  } else {
    const start = ta.selectionStart ?? body.value.length
    const end = ta.selectionEnd ?? start
    const before = body.value.slice(0, start)
    const after = body.value.slice(end)
    const needLeadSpace = before.length > 0 && !/\s$/.test(before)
    const needTrailSpace = after.length > 0 && !/^\s/.test(after)
    const insert = `${needLeadSpace ? ' ' : ''}${token}${needTrailSpace ? ' ' : ''}`
    body.value = `${before}${insert}${after}`
    nextTick(() => {
      const newPos = before.length + insert.length
      ta.focus()
      ta.setSelectionRange(newPos, newPos)
    })
  }
  showStickerPicker.value = false
}

function onDocClick(e: MouseEvent) {
  if (!showStickerPicker.value) return
  const target = e.target as HTMLElement
  if (!target.closest('[data-sticker-anchor]')) {
    showStickerPicker.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div
    class="relative"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div
      class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 transition-colors"
      :class="isDragOver ? 'ring-2 ring-brand-500/60 border-brand-500' : ''"
    >
      <textarea
        ref="textareaRef"
        :value="body"
        rows="3"
        :placeholder="placeholder ?? t('comments.composer_placeholder')"
        class="w-full resize-none rounded-t-lg bg-transparent px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none"
        @input="onInput"
        @keydown="onKeydown"
      />
      <!-- Pending files row -->
      <div
        v-if="pendingFiles.length > 0"
        class="flex flex-wrap gap-1.5 border-t border-surface-100 dark:border-surface-800 px-2 py-2"
      >
        <div
          v-for="(f, idx) in pendingFiles"
          :key="`${f.name}-${idx}`"
          class="inline-flex items-center gap-1.5 rounded-md bg-surface-100 dark:bg-surface-800 px-2 py-1 text-xs text-surface-700 dark:text-surface-300 max-w-[220px]"
        >
          <FileIcon class="size-3 text-surface-500 flex-shrink-0" />
          <span class="truncate" :title="f.name">{{ f.name }}</span>
          <span class="text-[10px] text-surface-400 flex-shrink-0">{{ prettySize(f.size) }}</span>
          <button
            type="button"
            class="flex-shrink-0 rounded p-0.5 text-surface-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 cursor-pointer border-0 bg-transparent"
            :title="t('attachments.remove')"
            @click="removeFile(idx)"
          >
            <X class="size-3" />
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between gap-2 border-t border-surface-100 dark:border-surface-800 px-2 py-1.5">
        <div class="flex items-center gap-2">
          <button
            v-if="canMarkInternal"
            type="button"
            class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors"
            :class="isInternal
              ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300'
              : 'text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800'"
            @click="isInternal = !isInternal"
          >
            <Lock class="size-3" />
            {{ isInternal ? t('comments.internal_on') : t('comments.internal_off') }}
          </button>
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer border-0 bg-transparent"
            :title="t('attachments.add')"
            :aria-label="t('attachments.add')"
            @click="fileInputRef?.click()"
          >
            <Paperclip class="size-3" />
            <span class="hidden sm:inline">{{ t('attachments.add') }}</span>
          </button>
          <div data-sticker-anchor class="relative">
            <button
              type="button"
              class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer border-0 bg-transparent"
              :class="showStickerPicker ? 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-200' : ''"
              :title="t('stickers.add')"
              :aria-label="t('stickers.add')"
              @click="showStickerPicker = !showStickerPicker"
            >
              <Smile class="size-3" />
              <span class="hidden sm:inline">{{ t('stickers.add') }}</span>
            </button>
            <StickerPicker
              v-if="showStickerPicker"
              @pick="insertSticker"
              @close="showStickerPicker = false"
            />
          </div>
          <input
            ref="fileInputRef"
            type="file"
            multiple
            class="sr-only"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif"
            @change="onFilePick"
          >
          <span class="text-xs text-surface-400 hidden md:inline">{{ t('comments.hint_shortcut') }}</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="parentCommentId"
            type="button"
            class="rounded-md px-2 py-1 text-xs text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800"
            @click="emit('cancel')"
          >
            {{ t('comments.cancel') }}
          </button>
          <button
            type="button"
            :disabled="(!body.trim() && pendingFiles.length === 0) || submitting"
            class="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            @click="submit"
          >
            <Send class="size-3" />
            {{ submitting ? t('comments.sending') : t('comments.send') }}
          </button>
        </div>
      </div>
    </div>
    <ApplicationMentionAutocomplete
      v-if="showAutocomplete"
      :members="memberCandidates"
      :active-index="activeMentionIdx"
      @pick="pickMember"
    />
  </div>
</template>
