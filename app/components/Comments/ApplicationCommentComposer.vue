<script setup lang="ts">
/**
 * Поле ввода обсуждения — новая оболочка (ТЗ docs/tz-discussion-shell.md §2.4).
 *
 * Одна строка: [+] textarea [⟶ Этап ▾] [🔒] [➤]
 *   - «+»    — файл, шаблон, прикрепить результат ИИ, спросить ИИ, сводка.
 *              Ввод «/» в пустом поле открывает это же меню.
 *   - «Этап» — отправить сообщение вместе со сменой этапа (одна запись
 *              kind='stage_comment'); без текста — обычный перевод.
 *   - 🔒     — внутреннее сообщение (только роли из INTERNAL_VISIBLE_ROLES).
 *   - Ctrl/Cmd+Enter — отправить. Enter — перенос строки.
 */
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import {
  Send, Lock, Plus, X, File as FileIcon, Paperclip, FileText, Bot, ShieldAlert,
  Sparkles, ArrowRight, ChevronRight, ChevronDown, AlertTriangle,
} from 'lucide-vue-next'
import ApplicationMentionAutocomplete from './ApplicationMentionAutocomplete.vue'
import { useApplicationComments, type OrgMember, type StageCommentPayload } from '~/composables/useApplicationComments'
import { useApplicationStages, type StageInfo, type StageMoveResult } from '~/composables/useApplicationStages'
import { useLocalStorageState } from '~/composables/useLocalStorageState'
import { isExternalAudienceRole } from '~~/shared/access/discussion'

const props = defineProps<{
  applicationId: string
  /** Можно ли переключать is_internal — роль из INTERNAL_VISIBLE_ROLES (см. shared/access/discussion). */
  canMarkInternal?: boolean
  /** Ответ: родительское сообщение (для плашки «Ответ: …»). */
  replyTo?: { id: string, author: string, preview: string } | null
  placeholder?: string
  compact?: boolean
}>()

const emit = defineEmits<{
  submitted: []
  cancel: []
  /**
   * Этап изменён (с сообщением или без). Родитель обязан пробросить это
   * как `stage-changed` на страницу/шторку — иначе карточка отклика
   * продолжит показывать старый этап до перезагрузки.
   */
  stageMoved: [payload: StageMoveResult]
}>()

const { t } = useI18n()
const toast = useToast()
const { createComment, uploadAttachment, searchMembers, attachSnapshot, summarize } = useApplicationComments(props.applicationId)
const { stages, currentStage, nextStage, rejectStage, fetchStages, moveStage } = useApplicationStages(props.applicationId)

const body = ref('')
const isInternal = ref(false)
const submitting = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingFiles = ref<File[]>([])
const isDragOver = ref(false)

// ── Черновик (localStorage) ──
interface DraftState { body: string, isInternal: boolean, savedAt: number }
const draftKey = `draft:comment:${props.applicationId}`
const draft = useLocalStorageState<DraftState>(draftKey, { body: '', isInternal: false, savedAt: 0 })
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

onMounted(() => {
  if (draft.value.body && Date.now() - draft.value.savedAt < DRAFT_MAX_AGE_MS) {
    body.value = draft.value.body
    isInternal.value = draft.value.isInternal
    nextTick(autosize)
  } else {
    draft.value = { body: '', isInternal: false, savedAt: 0 }
  }
})

let draftSaveTimer: ReturnType<typeof setTimeout> | null = null
watch([body, isInternal], () => {
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  draftSaveTimer = setTimeout(() => {
    draft.value = { body: body.value, isInternal: isInternal.value, savedAt: Date.now() }
  }, 500)
})

// ── Индикатор «печатает» (debounced POST) ──
let typingTimer: ReturnType<typeof setTimeout> | null = null
watch(body, () => {
  if (!body.value.trim()) return
  if (typingTimer) clearTimeout(typingTimer)
  typingTimer = setTimeout(() => {
    $fetch(`/api/applications/${props.applicationId}/typing`, { method: 'POST' }).catch(() => {})
  }, 300)
})

function clearDraft() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  draft.value = { body: '', isInternal: false, savedAt: 0 }
}

// ── Авторост textarea ──
function autosize() {
  const ta = textareaRef.value
  if (!ta) return
  ta.style.height = 'auto'
  const max = props.compact ? 120 : 160
  ta.style.height = `${Math.min(ta.scrollHeight, max)}px`
  ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden'
}

// ── Файлы ──
const MAX_FILES = 10
const MAX_FILE_BYTES = 10 * 1024 * 1024

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function addFiles(list: FileList | File[] | null) {
  if (!list) return
  for (const f of Array.from(list)) {
    if (pendingFiles.value.length >= MAX_FILES) {
      toast.error('Достигнут лимит файлов', { message: `Максимум ${MAX_FILES} файлов на сообщение` })
      break
    }
    if (f.size > MAX_FILE_BYTES) {
      toast.error('Файл слишком большой', { message: `${f.name} — максимум 10 МБ` })
      continue
    }
    pendingFiles.value.push(f)
  }
}
function removeFile(idx: number) { pendingFiles.value.splice(idx, 1) }
function onFilePick(e: Event) {
  const target = e.target as HTMLInputElement
  addFiles(target.files)
  target.value = ''
}
function onDragEnter(e: DragEvent) { e.preventDefault(); isDragOver.value = true }
function onDragLeave(e: DragEvent) { e.preventDefault(); if (e.currentTarget === e.target) isDragOver.value = false }
function onDragOver(e: DragEvent) { e.preventDefault(); isDragOver.value = true }
function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
}

// ── Упоминания ──
const mentionQuery = ref<string | null>(null)
const mentionPos = ref(0)
const memberCandidates = ref<OrgMember[]>([])
const activeMentionIdx = ref(0)
const showAutocomplete = computed(() => mentionQuery.value !== null && memberCandidates.value.length > 0)
/** Выбранные через автодополнение участники — чтобы предупредить об упоминании заказчика во внутреннем. */
const pickedMembers = ref<OrgMember[]>([])

let searchAbort: number | null = null
async function refreshMentionCandidates() {
  if (mentionQuery.value === null) { memberCandidates.value = []; return }
  if (searchAbort) window.clearTimeout(searchAbort)
  const q = mentionQuery.value
  searchAbort = window.setTimeout(async () => {
    memberCandidates.value = await searchMembers(q)
    activeMentionIdx.value = 0
  }, 120)
}

function onInput(e: Event) {
  const ta = e.target as HTMLTextAreaElement
  const value = ta.value
  body.value = value
  autosize()
  // «/» в пустом поле — открыть меню «+»
  if (value === '/') {
    body.value = ''
    plusOpen.value = true
    return
  }
  const caret = ta.selectionStart ?? value.length
  const before = value.slice(0, caret)
  const atIdx = before.lastIndexOf('@')
  if (atIdx < 0) { mentionQuery.value = null; return }
  const prev = atIdx === 0 ? ' ' : (before[atIdx - 1] ?? ' ')
  if (!/\s/.test(prev) && atIdx !== 0) { mentionQuery.value = null; return }
  const token = before.slice(atIdx + 1)
  if (/\s/.test(token) && !token.startsWith('"')) { mentionQuery.value = null; return }
  mentionQuery.value = token.replace(/^"/, '')
  mentionPos.value = atIdx
  refreshMentionCandidates()
}

function mentionToken(m: OrgMember): string {
  return m.name && /\s/.test(m.name) ? `@"${m.name}"` : `@${m.name ?? m.email?.split('@')[0] ?? ''}`
}

function pickMember(m: OrgMember) {
  const ta = textareaRef.value
  if (!ta) return
  const before = body.value.slice(0, mentionPos.value)
  const after = body.value.slice(ta.selectionStart ?? body.value.length)
  const insert = mentionToken(m)
  body.value = `${before}${insert} ${after}`
  mentionQuery.value = null
  if (!pickedMembers.value.some(p => p.userId === m.userId)) pickedMembers.value.push(m)
  nextTick(() => {
    ta.focus()
    const newPos = before.length + insert.length + 1
    ta.setSelectionRange(newPos, newPos)
    autosize()
  })
}

/** Заказчики/внешние, упомянутые в тексте внутреннего сообщения. */
const externalMentioned = computed(() => {
  if (!isInternal.value) return []
  return pickedMembers.value.filter(m => isExternalAudienceRole(m.role) && body.value.includes(mentionToken(m)))
})

function onKeydown(e: KeyboardEvent) {
  if (showAutocomplete.value) {
    if (e.key === 'ArrowDown') { activeMentionIdx.value = Math.min(activeMentionIdx.value + 1, memberCandidates.value.length - 1); e.preventDefault(); return }
    if (e.key === 'ArrowUp') { activeMentionIdx.value = Math.max(activeMentionIdx.value - 1, 0); e.preventDefault(); return }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const m = memberCandidates.value[activeMentionIdx.value]
      if (m) { pickMember(m); e.preventDefault(); return }
    }
    if (e.key === 'Escape') { mentionQuery.value = null; e.preventDefault(); return }
  }
  if (e.key === 'Escape') {
    if (plusOpen.value || stageOpen.value) { plusOpen.value = false; stageOpen.value = false; e.preventDefault(); return }
    if (props.replyTo) { emit('cancel'); e.preventDefault(); return }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    void submit()
  }
}

// ── Меню «+» ──
const plusOpen = ref(false)
const plusRoot = ref<HTMLElement | null>(null)
const templatesOpen = ref(false)
const snapshotsOpen = ref(false)
const busyAction = ref<string | null>(null)

interface MessageTemplate { id: string, title: string, body: string, category: string }
const templates = ref<MessageTemplate[] | null>(null)
async function loadTemplates() {
  if (templates.value) return
  try {
    templates.value = (await $fetch<MessageTemplate[]>('/api/message-templates')) ?? []
  } catch {
    templates.value = []
  }
}
watch(plusOpen, (open) => {
  if (!open) { templatesOpen.value = false; snapshotsOpen.value = false }
})
function toggleTemplates() {
  templatesOpen.value = !templatesOpen.value
  snapshotsOpen.value = false
  if (templatesOpen.value) void loadTemplates()
}
function toggleSnapshots() {
  snapshotsOpen.value = !snapshotsOpen.value
  templatesOpen.value = false
}
function pickTemplate(tpl: MessageTemplate) {
  const text = tpl.body.replace(/\{\{(candidate_name|job_title|deadline)\}\}/g, '')
  insertText(text.trim())
  plusOpen.value = false
}
async function onAttachSnapshot(kind: 'ai_screening_snapshot' | 'risk_snapshot') {
  if (busyAction.value) return
  busyAction.value = kind
  plusOpen.value = false
  try {
    await attachSnapshot(kind)
    emit('submitted')
  } catch {
    // тост уже показан в composable
  } finally {
    busyAction.value = null
  }
}
async function onSummarize() {
  if (busyAction.value) return
  busyAction.value = 'summarize'
  plusOpen.value = false
  try {
    await summarize()
    emit('submitted')
  } catch {
    // тост уже показан в composable
  } finally {
    busyAction.value = null
  }
}
function onAskAi() {
  plusOpen.value = false
  if (!/^@ai\b/i.test(body.value.trimStart())) body.value = `@ai ${body.value}`.trimEnd() + ' '
  nextTick(() => { textareaRef.value?.focus(); autosize() })
}

// ── Этап ──
const stageOpen = ref(false)
const stageRoot = ref<HTMLElement | null>(null)
const selectedStage = ref<StageInfo | null>(null)
const stagesLoaded = ref(false)
async function toggleStageMenu() {
  stageOpen.value = !stageOpen.value
  plusOpen.value = false
  if (stageOpen.value && !stagesLoaded.value) {
    await fetchStages()
    stagesLoaded.value = true
  }
}
const visibleStages = computed(() =>
  stages.value.filter(s => !s.isArchived && !s.isHidden && s.id !== currentStage.value?.id),
)
function pickStage(s: StageInfo) {
  selectedStage.value = s
  stageOpen.value = false
  nextTick(() => textareaRef.value?.focus())
}
function clearStage() { selectedStage.value = null }
const stageIsReject = computed(() => selectedStage.value?.bucket === 'rejected')

const effectivePlaceholder = computed(() => {
  if (props.placeholder) return props.placeholder
  if (selectedStage.value) return stageIsReject.value ? t('comments.placeholder_reject') : t('comments.placeholder_stage')
  if (isInternal.value) return t('comments.placeholder_internal')
  return t('comments.placeholder_team')
})

// ── Клик вне меню ──
function onDocClick(e: MouseEvent) {
  const target = e.target as Node
  if (plusOpen.value && plusRoot.value && !plusRoot.value.contains(target)) plusOpen.value = false
  if (stageOpen.value && stageRoot.value && !stageRoot.value.contains(target)) stageOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

// ── Отправка ──
const canSubmit = computed(() => !submitting.value && (body.value.trim().length > 0 || pendingFiles.value.length > 0 || !!selectedStage.value))

async function submit() {
  const trimmed = body.value.trim()
  if (!canSubmit.value) return
  submitting.value = true
  try {
    // Только смена этапа, без текста и файлов → обычный перевод.
    if (!trimmed && pendingFiles.value.length === 0 && selectedStage.value) {
      const moved = await moveStage(selectedStage.value.id)
      if (moved) { selectedStage.value = null; emit('stageMoved', moved) }
      return
    }
    const finalBody = trimmed.length > 0
      ? trimmed
      : (pendingFiles.value.length === 1 ? pendingFiles.value[0]!.name : t('attachments.files_attached', { n: pendingFiles.value.length }))

    const created = await createComment({
      body: finalBody,
      isInternal: isInternal.value,
      parentCommentId: props.replyTo?.id ?? undefined,
      moveToStageId: selectedStage.value?.id,
    })
    if (created?.id && pendingFiles.value.length > 0) {
      for (const f of pendingFiles.value) await uploadAttachment(created.id, f)
    }
    const movedStage = selectedStage.value
    body.value = ''
    isInternal.value = false
    pendingFiles.value = []
    pickedMembers.value = []
    selectedStage.value = null
    clearDraft()
    nextTick(autosize)
    if (movedStage) {
      // Сервер вернул payload перевода только если этап реально сменился (не noop).
      const payload = created?.kind === 'stage_comment' ? (created.payloadJson as StageCommentPayload | null) : null
      if (payload) {
        toast.success(t('comments.move_stage_success', { stage: payload.toStageName }))
        emit('stageMoved', { newStageId: payload.toStageId, newStageName: payload.toStageName, newStageColor: payload.toStageColor ?? '' })
      } else {
        toast.info(t('comments.stage_already'), movedStage.name ?? '')
      }
    }
    emit('submitted')
  } catch {
    // тост уже показан в composable (в т.ч. 422 «нужен комментарий» при переводе)
  } finally {
    submitting.value = false
  }
}

function focus() { textareaRef.value?.focus() }

function insertText(text: string) {
  const ta = textareaRef.value
  if (!ta) {
    body.value = body.value ? `${body.value} ${text}` : text
    return
  }
  const start = ta.selectionStart ?? body.value.length
  const end = ta.selectionEnd ?? start
  const before = body.value.slice(0, start)
  const after = body.value.slice(end)
  const needSpace = before.length > 0 && !/\s$/.test(before)
  body.value = `${before}${needSpace ? ' ' : ''}${text} ${after}`
  nextTick(() => {
    const newPos = before.length + (needSpace ? 1 : 0) + text.length + 1
    ta.focus()
    ta.setSelectionRange(newPos, newPos)
    autosize()
  })
}

defineExpose({ focus, insertText })

const menuItemClass = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
const squareBtnClass = 'inline-flex size-8 flex-shrink-0 items-center justify-center rounded-lg border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
</script>

<template>
  <div
    class="relative"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Предупреждение: заказчик упомянут во внутреннем сообщении -->
    <div
      v-if="externalMentioned.length > 0"
      class="mb-1.5 flex items-center gap-2 rounded-lg bg-warning-100 dark:bg-warning-900/30 px-2.5 py-1.5 text-[11px] text-warning-800 dark:text-warning-200"
    >
      <AlertTriangle class="size-3.5 flex-shrink-0" />
      <span class="flex-1">{{ t('comments.internal_mention_warning', { names: externalMentioned.map(m => m.name || m.email).join(', ') }) }}</span>
      <button type="button" class="underline cursor-pointer" @click="isInternal = false">{{ t('comments.make_visible') }}</button>
    </div>

    <!-- Плашка ответа -->
    <div
      v-if="replyTo"
      class="mb-1.5 flex items-center gap-2 rounded-r-md border-l-2 border-brand-500 bg-surface-50 dark:bg-surface-800/60 px-2.5 py-1 text-[11px] text-surface-500 dark:text-surface-400"
    >
      <span class="flex-shrink-0">{{ t('comments.reply_label') }}</span>
      <span class="font-semibold text-brand-700 dark:text-brand-300 flex-shrink-0">{{ replyTo.author }}</span>
      <span class="truncate">{{ replyTo.preview }}</span>
      <button type="button" class="ml-auto rounded p-0.5 text-surface-400 hover:text-surface-700 cursor-pointer" :title="t('comments.cancel')" @click="emit('cancel')">
        <X class="size-3" />
      </button>
    </div>

    <div class="flex items-end gap-1.5">
      <!-- «+» -->
      <div ref="plusRoot" class="relative">
        <button
          type="button"
          :class="[squareBtnClass, plusOpen
            ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
            : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-500 hover:bg-surface-50 dark:hover:bg-surface-800']"
          :title="t('comments.plus_title')"
          :aria-label="t('comments.plus_title')"
          @click="plusOpen = !plusOpen; stageOpen = false"
        >
          <Plus class="size-4" />
        </button>
        <div
          v-if="plusOpen"
          class="absolute bottom-full left-0 z-30 mb-1.5 w-64 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-1 shadow-lg"
        >
          <button type="button" :class="menuItemClass" @click="plusOpen = false; fileInputRef?.click()">
            <Paperclip class="size-3.5 text-surface-400" />
            {{ t('attachments.add') }}
            <span class="ml-auto text-[10px] text-surface-400">{{ t('comments.drag_hint') }}</span>
          </button>
          <!-- Шаблон ▸ -->
          <button type="button" :class="menuItemClass" @click="toggleTemplates">
            <FileText class="size-3.5 text-surface-400" />
            {{ t('comments.templates') }}
            <component :is="templatesOpen ? ChevronDown : ChevronRight" class="ml-auto size-3.5 text-surface-400" />
          </button>
          <div v-if="templatesOpen" class="ml-5 mb-1 max-h-48 overflow-y-auto scrollbar-thin border-l border-surface-100 dark:border-surface-800 pl-1">
            <div v-if="templates === null" class="px-2 py-1.5 text-[11px] text-surface-400">{{ t('comments.loading') }}</div>
            <div v-else-if="templates.length === 0" class="px-2 py-1.5 text-[11px] italic text-surface-400">{{ t('comments.templates_empty') }}</div>
            <button
              v-for="tpl in templates"
              v-else
              :key="tpl.id"
              type="button"
              :class="menuItemClass"
              class="flex-col !items-start gap-0"
              @click="pickTemplate(tpl)"
            >
              <span class="font-medium">{{ tpl.title }}</span>
              <span class="w-full truncate text-[10px] text-surface-400">{{ tpl.body }}</span>
            </button>
          </div>
          <div class="my-1 h-px bg-surface-100 dark:bg-surface-800" />
          <div class="px-2.5 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-surface-400">{{ t('comments.ai_section') }}</div>
          <!-- Прикрепить результат ▸ -->
          <button type="button" :class="menuItemClass" @click="toggleSnapshots">
            <Bot class="size-3.5 text-accent-500" />
            {{ t('comment_snapshot.attach_label') }}
            <component :is="snapshotsOpen ? ChevronDown : ChevronRight" class="ml-auto size-3.5 text-surface-400" />
          </button>
          <div v-if="snapshotsOpen" class="ml-5 mb-1 border-l border-surface-100 dark:border-surface-800 pl-1">
            <button type="button" :class="menuItemClass" :disabled="!!busyAction" @click="onAttachSnapshot('ai_screening_snapshot')">
              <Bot class="size-3.5 text-accent-500" /> {{ t('discussion_widgets.screening') }}
            </button>
            <button type="button" :class="menuItemClass" :disabled="!!busyAction" @click="onAttachSnapshot('risk_snapshot')">
              <ShieldAlert class="size-3.5 text-warning-500" /> {{ t('discussion_widgets.risk') }}
            </button>
          </div>
          <button type="button" :class="menuItemClass" @click="onAskAi">
            <Sparkles class="size-3.5 text-accent-500" />
            {{ t('comments.ask_ai') }}
            <span class="ml-auto font-mono text-[10px] text-surface-400">@ai</span>
          </button>
          <button type="button" :class="menuItemClass" :disabled="!!busyAction" @click="onSummarize">
            <Sparkles class="size-3.5 text-accent-500" />
            {{ busyAction === 'summarize' ? t('comments.summarizing') : t('comments.summarize_thread') }}
          </button>
        </div>
        <input
          ref="fileInputRef"
          type="file"
          multiple
          class="sr-only"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif"
          @change="onFilePick"
        >
      </div>

      <!-- Поле -->
      <div
        class="min-w-0 flex-1 rounded-xl border transition-colors focus-within:ring-2"
        :class="[
          isInternal
            ? 'border-warning-300 dark:border-warning-700/60 bg-warning-50 dark:bg-warning-900/15 focus-within:border-warning-500 focus-within:ring-warning-500/20'
            : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 focus-within:border-brand-500 focus-within:ring-brand-500/20',
          isDragOver ? 'ring-2 ring-brand-500/60 border-brand-500' : '',
        ]"
      >
        <textarea
          ref="textareaRef"
          :value="body"
          rows="1"
          :placeholder="effectivePlaceholder"
          :title="t('comments.hint_shortcut')"
          class="block w-full resize-none bg-transparent px-3 py-1.5 text-sm leading-5 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none"
          style="min-height: 32px; overflow-y: hidden"
          @input="onInput"
          @keydown="onKeydown"
        />
        <div v-if="pendingFiles.length > 0" class="flex flex-wrap gap-1.5 border-t border-surface-100 dark:border-surface-800 px-2 py-1.5">
          <div
            v-for="(f, idx) in pendingFiles"
            :key="`${f.name}-${idx}`"
            class="inline-flex max-w-[220px] items-center gap-1.5 rounded-md bg-surface-100 dark:bg-surface-800 px-2 py-1 text-xs text-surface-700 dark:text-surface-300"
          >
            <FileIcon class="size-3 flex-shrink-0 text-surface-500" />
            <span class="truncate" :title="f.name">{{ f.name }}</span>
            <span class="flex-shrink-0 text-[10px] text-surface-400">{{ prettySize(f.size) }}</span>
            <button type="button" class="flex-shrink-0 rounded p-0.5 text-surface-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30 cursor-pointer" :title="t('attachments.remove')" @click="removeFile(idx)">
              <X class="size-3" />
            </button>
          </div>
        </div>
      </div>

      <!-- Этап -->
      <div ref="stageRoot" class="relative">
        <button
          type="button"
          class="inline-flex h-8 max-w-[220px] flex-shrink-0 items-center gap-1 rounded-lg border px-2 text-xs transition-colors cursor-pointer"
          :class="selectedStage
            ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
            : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800'"
          :title="t('comments.stage_chip_hint')"
          @click="toggleStageMenu"
        >
          <ArrowRight class="size-3.5 flex-shrink-0" />
          <span class="truncate" :class="compact && !selectedStage ? 'hidden sm:inline' : ''">
            {{ selectedStage ? (selectedStage.name ?? '') : t('comments.stage_chip') }}
          </span>
          <span
            v-if="selectedStage"
            role="button"
            class="ml-0.5 rounded p-0.5 hover:bg-brand-100 dark:hover:bg-brand-900/50"
            :title="t('comments.cancel')"
            @click.stop="clearStage"
          >
            <X class="size-3" />
          </span>
          <ChevronDown v-else class="size-3 flex-shrink-0 text-surface-400" />
        </button>
        <div
          v-if="stageOpen"
          class="absolute bottom-full right-0 z-30 mb-1.5 w-64 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-1 shadow-lg"
        >
          <div class="px-2.5 pb-1 pt-1 text-[10px] uppercase tracking-wide text-surface-400">{{ t('comments.stage_menu_title') }}</div>
          <div v-if="!stagesLoaded" class="px-2.5 py-1.5 text-[11px] text-surface-400">{{ t('comments.loading') }}</div>
          <div v-else-if="visibleStages.length === 0" class="px-2.5 py-1.5 text-[11px] italic text-surface-400">{{ t('comments.stage_none') }}</div>
          <div v-else class="max-h-64 overflow-y-auto scrollbar-thin">
            <button
              v-for="s in visibleStages"
              :key="s.id"
              type="button"
              :class="menuItemClass"
              @click="pickStage(s)"
            >
              <span class="size-2 flex-shrink-0 rounded-full" :style="{ backgroundColor: s.color ?? '#94a3b8' }" />
              <span class="truncate" :class="s.bucket === 'rejected' ? 'text-danger-600 dark:text-danger-400' : ''">{{ s.name }}</span>
              <span v-if="s.id === nextStage?.id" class="ml-auto text-[10px] text-surface-400">{{ t('comments.stage_next') }}</span>
              <span v-else-if="s.id === rejectStage?.id" class="ml-auto text-[10px] text-surface-400">{{ t('comments.reject') }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Замок -->
      <button
        v-if="canMarkInternal"
        type="button"
        :class="[squareBtnClass, isInternal
          ? 'border-warning-300 bg-warning-100 text-warning-800 dark:border-warning-700/60 dark:bg-warning-900/40 dark:text-warning-200'
          : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-500 hover:bg-surface-50 dark:hover:bg-surface-800']"
        :title="isInternal ? t('comments.internal_on_hint') : t('comments.internal_off_hint')"
        :aria-pressed="isInternal"
        @click="isInternal = !isInternal"
      >
        <Lock class="size-3.5" />
      </button>

      <!-- Отправить -->
      <button
        type="button"
        :disabled="!canSubmit"
        :class="[squareBtnClass, 'border-transparent bg-brand-600 text-white hover:bg-brand-700']"
        :title="t('comments.hint_shortcut')"
        :aria-label="t('comments.send')"
        @click="submit"
      >
        <span v-if="submitting" class="inline-block size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        <Send v-else class="size-3.5" />
      </button>
    </div>

    <ApplicationMentionAutocomplete
      v-if="showAutocomplete"
      :members="memberCandidates"
      :active-index="activeMentionIdx"
      @pick="pickMember"
    />
  </div>
</template>
