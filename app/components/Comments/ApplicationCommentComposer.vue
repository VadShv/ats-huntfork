<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { Send, Lock } from 'lucide-vue-next'
import ApplicationMentionAutocomplete from './ApplicationMentionAutocomplete.vue'
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
const { createComment, searchMembers } = useApplicationComments(props.applicationId)

const body = ref('')
const isInternal = ref(false)
const submitting = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

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
  if (!trimmed || submitting.value) return
  submitting.value = true
  try {
    await createComment({
      body: trimmed,
      isInternal: isInternal.value,
      parentCommentId: props.parentCommentId ?? undefined,
    })
    body.value = ''
    isInternal.value = false
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
</script>

<template>
  <div class="relative">
    <div class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 transition-colors">
      <textarea
        ref="textareaRef"
        :value="body"
        rows="3"
        :placeholder="placeholder ?? t('comments.composer_placeholder')"
        class="w-full resize-none rounded-t-lg bg-transparent px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none"
        @input="onInput"
        @keydown="onKeydown"
      />
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
          <span class="text-xs text-surface-400 hidden sm:inline">{{ t('comments.hint_shortcut') }}</span>
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
            :disabled="!body.trim() || submitting"
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
