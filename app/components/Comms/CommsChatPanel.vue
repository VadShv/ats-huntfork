<script setup lang="ts">
/**
 * Переиспользуемая панель чата с кандидатом (Спринт 18).
 *
 * Единый компонент для всех мест, где показывается отклик:
 * сайдбар кандидата, полная страница отклика, drawer'ы (воронка, списки).
 * MVP-канал — hh.ru (sync-on-read). Поллинг 30с только пока компонент
 * смонтирован и вкладка браузера видима.
 */
import { Bot, Check, Copy, MessageSquare, Paperclip, RefreshCw, Send, Sparkles } from 'lucide-vue-next'

const props = defineProps<{
  applicationId: string
}>()

const emit = defineEmits<{
  meta: [payload: { unreadCount: number }]
}>()

const { t } = useI18n()
const { track } = useTrack()

interface ChatMessage {
  id: string
  direction: 'in' | 'out'
  senderType: string
  senderName: string | null
  body: string | null
  attachments: unknown[] | null
  status: string
  errorMessage?: string | null
  createdAt: string | null
}

interface ChatConversation {
  id: string
  channel: 'hh' | 'telegram'
  canWrite: boolean
  canWriteReason: string | null
  unreadCount: number
  assistantMode: string
  /** Спринт 19.5: чат личного аккаунта рекрутёра (Telegram Business). */
  business?: { connected: boolean, canReply: boolean, windowOpen: boolean, lastInboundAt: string | null } | null
}

/** Спринт 19: сводка по каналам отклика (hh + telegram). */
interface ChannelInfo {
  id: string
  channel: 'hh' | 'telegram'
  unreadCount: number
  canWrite: boolean
  lastMessageAt: string | null
}

/** Метаданные вложения Telegram (сохранено в S3). */
interface TgAttachment {
  kind?: string
  name?: string
  mimeType?: string
  size?: number
  s3Key?: string
}

/** Чат 2.0: черновик ассистента живёт на сервере — переживает перезагрузку страницы. */
interface AssistantDraft {
  id: string
  status: 'generating' | 'suggested'
  body: string | null
  senderName: string | null
  errorMessage: string | null
  createdAt: string | Date | null
}

const chatConversation = ref<ChatConversation | null>(null)
const chatChannels = ref<ChannelInfo[]>([])
const telegramAvailable = ref(false)
const activeChannel = ref<'hh' | 'telegram' | null>(null)
const channelSwitching = ref(false)
const inviteLoading = ref(false)
const inviteCopied = ref(false)
const inviteError = ref<string | null>(null)
const chatMessages = ref<ChatMessage[]>([])
const chatReason = ref<string | null>(null)
const chatSyncError = ref<string | null>(null)
const chatLoading = ref(false)
const chatLoaded = ref(false)
const chatSending = ref(false)
const chatSendError = ref<string | null>(null)
const chatText = ref('')
const chatScrollEl = ref<HTMLElement | null>(null)
let chatPollTimer: ReturnType<typeof setInterval> | null = null

const chatEmptyHint = computed(() => {
  if (chatReason.value === 'hh_api_error') return t('dashboard.chat.emptyHintError')
  return t('dashboard.chat.emptyHint')
})

function formatChatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function scrollChatToBottom() {
  nextTick(() => {
    const el = chatScrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

async function loadChat(silent = false) {
  if (!props.applicationId) return
  if (!silent) chatLoading.value = true
  try {
    const res = await $fetch<{
      conversation: ChatConversation | null
      messages: ChatMessage[]
      reason?: string
      syncError?: string | null
      draft?: AssistantDraft | null
      channels?: ChannelInfo[]
      telegramAvailable?: boolean
    }>(`/api/applications/${props.applicationId}/conversations`, {
      query: activeChannel.value ? { channel: activeChannel.value } : {},
    })
    const prevCount = chatMessages.value.length
    chatConversation.value = res.conversation
    chatReason.value = res.reason ?? null
    chatSyncError.value = res.syncError ?? null
    chatMessages.value = res.messages ?? []
    chatChannels.value = res.channels ?? []
    telegramAvailable.value = res.telegramAvailable ?? false
    if (res.conversation) activeChannel.value = res.conversation.channel
    chatLoaded.value = true
    adoptDraft(res.draft ?? null) // Чат 2.0: возобновляем генерацию/черновик после перезагрузки
    if (!silent || chatMessages.value.length !== prevCount) scrollChatToBottom()
    if (res.conversation) {
      emit('meta', { unreadCount: res.conversation.unreadCount })
      if (res.conversation.unreadCount > 0) {
        $fetch(`/api/conversations/${res.conversation.id}/read`, { method: 'POST' }).catch(() => {})
        chatConversation.value = { ...res.conversation, unreadCount: 0 }
      }
    }
  }
  catch (err: any) {
    chatSyncError.value = err?.data?.statusMessage ?? t('dashboard.chat.loadError')
    chatLoaded.value = true
  }
  finally {
    chatLoading.value = false
  }
}

function stopChatPolling() {
  if (chatPollTimer) {
    clearInterval(chatPollTimer)
    chatPollTimer = null
  }
}

function startChatPolling() {
  stopChatPolling()
  chatPollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    if (!chatSending.value) loadChat(true)
  }, 30000)
}

/** Спринт 19: переключение между каналами (hh ↔ telegram). */
async function switchChannel(ch: 'hh' | 'telegram') {
  if (channelSwitching.value || activeChannel.value === ch) return
  channelSwitching.value = true
  activeChannel.value = ch
  chatDraft.value = null
  stopDraftPolling()
  try {
    await loadChat()
    track('chat_channel_switch', { channel: ch })
  }
  finally {
    channelSwitching.value = false
  }
}

/** Спринт 19: персональная ссылка-приглашение в Telegram (копируем в буфер). */
async function copyTelegramInvite() {
  if (inviteLoading.value) return
  inviteLoading.value = true
  inviteError.value = null
  try {
    const res = await $fetch<{ link: string }>(`/api/applications/${props.applicationId}/telegram-invite`, { method: 'POST' })
    await navigator.clipboard.writeText(res.link)
    inviteCopied.value = true
    setTimeout(() => { inviteCopied.value = false }, 2500)
    track('chat_tg_invite_copied', {})
  }
  catch (err: any) {
    inviteError.value = err?.data?.statusMessage ?? t('dashboard.chat.inviteError')
  }
  finally {
    inviteLoading.value = false
  }
}

/** Спринт 19.5: первый контакт в личном ТГ — ИИ-драфт + ссылка t.me с текстом. */
const firstContactLoading = ref(false)
const firstContactError = ref<string | null>(null)
async function openTelegramFirstContact() {
  if (firstContactLoading.value) return
  firstContactLoading.value = true
  firstContactError.value = null
  try {
    const res = await $fetch<{ link: string }>(`/api/applications/${props.applicationId}/telegram-first-contact`, { method: 'POST' })
    window.open(res.link, '_blank', 'noopener')
    track('chat_tg_first_contact', {})
  }
  catch (err: any) {
    firstContactError.value = err?.data?.statusMessage ?? t('dashboard.chat.firstContactError')
  }
  finally {
    firstContactLoading.value = false
  }
}

function typedAttachments(m: ChatMessage): TgAttachment[] {
  return Array.isArray(m.attachments) ? m.attachments as TgAttachment[] : []
}

function attachmentUrl(m: ChatMessage, idx: number): string {
  return `/api/comms/messages/${m.id}/attachments/${idx}`
}

function isImageAttachment(a: TgAttachment): boolean {
  return a.kind === 'photo' || (a.mimeType ?? '').startsWith('image/')
}

async function sendChatMessage() {
  const text = chatText.value.trim()
  if (!text || chatSending.value || !chatConversation.value?.canWrite) return
  chatSending.value = true
  chatSendError.value = null
  try {
    const res = await $fetch<{ message: ChatMessage }>(`/api/conversations/${chatConversation.value.id}/messages`, {
      method: 'POST',
      body: { text },
    })
    chatMessages.value = [...chatMessages.value, res.message]
    chatText.value = ''
    scrollChatToBottom()
    track('chat_message_sent', { channel: chatConversation.value?.channel ?? 'hh' })
  }
  catch (err: any) {
    chatSendError.value = err?.data?.statusMessage ?? t('dashboard.chat.sendError')
  }
  finally {
    chatSending.value = false
  }
}

const chatSuggesting = ref(false)
const chatSuggestError = ref<string | null>(null)
const assistantSwitching = ref(false)

// ── Чат 2.0: живучий черновик ассистента (генерация в фоне на сервере) ──
const chatDraft = ref<AssistantDraft | null>(null)
const draftResolving = ref(false)
let draftPollTimer: ReturnType<typeof setInterval> | null = null
let draftDeadline = 0

/** Суфлёрский черновик автоматом уезжает в композер; автопилотный — на ревью. */
const draftNeedsReview = computed(() =>
  chatDraft.value?.status === 'suggested'
  && (chatConversation.value?.assistantMode === 'autopilot_review' || chatConversation.value?.assistantMode === 'autopilot'))

function stopDraftPolling() {
  if (draftPollTimer) {
    clearInterval(draftPollTimer)
    draftPollTimer = null
  }
}

function startDraftPolling() {
  if (draftPollTimer) return
  draftDeadline = Date.now() + 4.5 * 60 * 1000
  draftPollTimer = setInterval(async () => {
    const conv = chatConversation.value
    if (!conv) return
    if (Date.now() > draftDeadline) {
      stopDraftPolling()
      chatDraft.value = null
      chatSuggestError.value = t('dashboard.chat.draftTimeout')
      return
    }
    try {
      const res = await $fetch<{ draft: AssistantDraft | null }>(`/api/conversations/${conv.id}/suggest`)
      adoptDraft(res.draft)
    }
    catch { /* сетевая икота — попробуем в следующий тик */ }
  }, 2500)
}

/** Единая точка приёма черновика (из loadChat, POST suggest и поллинга). */
function adoptDraft(draft: AssistantDraft | null) {
  const prev = chatDraft.value
  if (!draft) {
    // Шла генерация и черновик пропал — значит, генерация упала
    if (prev?.status === 'generating') {
      chatSuggestError.value = t('dashboard.chat.draftFailed')
    }
    chatDraft.value = null
    stopDraftPolling()
    return
  }
  if (draft.status === 'generating') {
    chatDraft.value = draft
    startDraftPolling()
    return
  }
  // suggested
  stopDraftPolling()
  const mode = chatConversation.value?.assistantMode
  if ((mode === 'copilot' || mode === 'off') && !chatText.value.trim()) {
    // Суфлёр: готовый черновик — сразу в композер, на сервере помечаем использованным
    chatText.value = draft.body ?? ''
    chatDraft.value = null
    resolveDraft(draft.id, 'consume', { silent: true })
  }
  else {
    // Ревью-карточка (автопилот) или в композере уже есть текст
    chatDraft.value = draft
  }
}

async function resolveDraft(draftId: string, action: 'consume' | 'discard' | 'approve', opts: { silent?: boolean } = {}) {
  const conv = chatConversation.value
  if (!conv) return
  if (!opts.silent) draftResolving.value = true
  try {
    const res = await $fetch<{ ok: boolean, message?: ChatMessage }>(`/api/conversations/${conv.id}/drafts/${draftId}`, {
      method: 'POST',
      body: { action },
    })
    if (action === 'approve' && res.message) {
      chatMessages.value = [...chatMessages.value, res.message]
      scrollChatToBottom()
      track('chat_assistant_approve', { channel: chatConversation.value?.channel ?? 'hh' })
    }
    if (action === 'consume' && !opts.silent) {
      chatText.value = chatDraft.value?.body ?? chatText.value
    }
    if (!opts.silent || action !== 'consume') chatDraft.value = null
  }
  catch (err: any) {
    chatSuggestError.value = err?.data?.statusMessage ?? t('dashboard.chat.assistantError')
  }
  finally {
    draftResolving.value = false
  }
}

/** «✨ Предложить ответ» — запуск фоновой генерации черновика (Чат 2.0). */
async function suggestAssistantReply() {
  const conv = chatConversation.value
  if (!conv || chatSuggesting.value || chatDraft.value || !conv.canWrite) return
  chatSuggesting.value = true
  chatSuggestError.value = null
  try {
    const res = await $fetch<{ draft: AssistantDraft }>(`/api/conversations/${conv.id}/suggest`, { method: 'POST' })
    adoptDraft(res.draft)
    track('chat_assistant_suggest', { channel: chatConversation.value?.channel ?? 'hh' })
  }
  catch (err: any) {
    const code = err?.data?.data?.code
    chatSuggestError.value = code === 'assistant_disabled' || code === 'assistant_no_config'
      ? t('dashboard.chat.assistantNotConfigured')
      : (err?.data?.statusMessage ?? t('dashboard.chat.assistantError'))
  }
  finally {
    chatSuggesting.value = false
  }
}

/** Чат 2.0: четыре режима ассистента per-диалог. */
const assistantModes = computed(() => ([
  { value: 'off', label: t('dashboard.chat.modeOff') },
  { value: 'copilot', label: t('dashboard.chat.modeCopilot') },
  { value: 'autopilot_review', label: t('dashboard.chat.modeAutopilotReview') },
  { value: 'autopilot', label: t('dashboard.chat.modeAutopilot') },
]))

async function changeAssistantMode(event: Event) {
  const conv = chatConversation.value
  const next = (event.target as HTMLSelectElement).value
  if (!conv || assistantSwitching.value || next === conv.assistantMode) return
  const prev = conv.assistantMode
  assistantSwitching.value = true
  conv.assistantMode = next
  try {
    await $fetch(`/api/conversations/${conv.id}/assistant`, { method: 'PATCH', body: { mode: next } })
    track('chat_assistant_mode', { mode: next })
  }
  catch {
    conv.assistantMode = prev // откат — состояние на сервере не поменялось
  }
  finally {
    assistantSwitching.value = false
  }
}

watch(() => props.applicationId, () => {
  chatConversation.value = null
  chatMessages.value = []
  chatReason.value = null
  chatSyncError.value = null
  chatSendError.value = null
  chatSuggestError.value = null
  chatText.value = ''
  chatLoaded.value = false
  chatDraft.value = null
  chatChannels.value = []
  activeChannel.value = null
  inviteError.value = null
  stopDraftPolling()
  loadChat()
})

onMounted(() => {
  loadChat()
  startChatPolling()
})

onBeforeUnmount(() => {
  stopChatPolling()
  stopDraftPolling()
})
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="chatLoading && !chatLoaded" class="text-center py-12 text-surface-400">
      <div class="size-6 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin mx-auto mb-3" />
      {{ t('dashboard.chat.loading') }}
    </div>

    <!-- No chat available -->
    <div
      v-else-if="!chatConversation"
      class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-8 text-center shadow-sm shadow-surface-900/[0.03] dark:shadow-none"
    >
      <div class="flex size-14 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
        <MessageSquare class="size-6 text-surface-400 dark:text-surface-500" />
      </div>
      <p class="text-sm font-medium text-surface-600 dark:text-surface-300">{{ t('dashboard.chat.empty') }}</p>
      <p class="text-xs text-surface-400 dark:text-surface-500 mt-1.5">{{ chatEmptyHint }}</p>
      <!-- Спринт 19: чата ещё нет, но можно пригласить кандидата в Telegram -->
      <div v-if="telegramAvailable" class="mt-4">
        <button
          class="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-surface-200/80 dark:border-surface-700/60 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/60 disabled:opacity-50 transition-colors"
          :disabled="inviteLoading"
          @click="copyTelegramInvite()"
        >
          <Check v-if="inviteCopied" class="size-3.5 text-success-600" />
          <Copy v-else class="size-3.5" />
          {{ inviteCopied ? t('dashboard.chat.inviteCopied') : t('dashboard.chat.inviteTelegram') }}
        </button>
        <p class="text-[11px] text-surface-400 dark:text-surface-500 mt-1.5">{{ t('dashboard.chat.inviteHint') }}</p>
        <p v-if="inviteError" class="text-xs text-danger-600 dark:text-danger-400 mt-1">{{ inviteError }}</p>
        <!-- Спринт 19.5: первый контакт через личный ТГ рекрутёра -->
        <div class="mt-2">
          <button
            class="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-surface-200/80 dark:border-surface-700/60 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/60 disabled:opacity-50 transition-colors"
            :disabled="firstContactLoading"
            @click="openTelegramFirstContact()"
          >
            <Send class="size-3.5" />
            {{ firstContactLoading ? t('dashboard.chat.firstContactLoading') : t('dashboard.chat.firstContact') }}
          </button>
          <p class="text-[11px] text-surface-400 dark:text-surface-500 mt-1.5">{{ t('dashboard.chat.firstContactHint') }}</p>
          <p v-if="firstContactError" class="text-xs text-danger-600 dark:text-danger-400 mt-1">{{ firstContactError }}</p>
        </div>
      </div>
    </div>

    <!-- Chat -->
    <div v-else class="flex flex-col">
      <div class="flex items-center justify-between mb-2">
        <!-- Спринт 19: переключатель каналов (если их больше одного) -->
        <div class="flex items-center gap-1.5">
          <template v-if="chatChannels.length > 1">
            <button
              v-for="c in chatChannels"
              :key="c.id"
              class="cursor-pointer inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
              :class="activeChannel === c.channel
                ? 'bg-brand-600 text-white'
                : 'bg-surface-100 dark:bg-surface-800/60 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700/60'"
              :disabled="channelSwitching"
              @click="switchChannel(c.channel)"
            >
              {{ c.channel === 'telegram' ? t('dashboard.chat.channelTelegram') : t('dashboard.chat.channelHh') }}
              <span
                v-if="c.unreadCount > 0 && activeChannel !== c.channel"
                class="inline-flex items-center justify-center min-w-4 h-4 rounded-full bg-brand-600 text-white text-[9px] px-1 tabular-nums"
              >{{ c.unreadCount }}</span>
            </button>
          </template>
          <span v-else class="inline-flex items-center gap-1.5 text-xs font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider">
            <MessageSquare class="size-3.5" />
            {{ chatConversation.channel === 'telegram' ? t('dashboard.chat.viaTelegram') : t('dashboard.chat.viaHh') }}
          </span>
          <!-- Приглашение в Telegram, пока tg-диалога ещё нет -->
          <button
            v-if="telegramAvailable && !chatChannels.some(c => c.channel === 'telegram')"
            class="cursor-pointer inline-flex items-center gap-1 rounded-full border border-surface-200/80 dark:border-surface-700/60 px-2.5 py-1 text-[11px] font-medium text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800/60 disabled:opacity-50 transition-colors"
            :disabled="inviteLoading"
            :title="t('dashboard.chat.inviteHint')"
            @click="copyTelegramInvite()"
          >
            <Check v-if="inviteCopied" class="size-3 text-success-600" />
            <Copy v-else class="size-3" />
            {{ inviteCopied ? t('dashboard.chat.inviteCopied') : t('dashboard.chat.inviteTelegram') }}
          </button>
        </div>
        <div class="flex items-center gap-2">
          <!-- Чат 2.0: режим ассистента — выкл / суфлёр / автопилот+ревью / автопилот -->
          <span
            class="inline-flex items-center gap-1.5 rounded-full pl-2 pr-1 py-0.5 text-[11px] font-medium transition-colors"
            :class="chatConversation.assistantMode !== 'off'
              ? 'bg-brand-600 text-white'
              : 'bg-surface-100 dark:bg-surface-800/60 text-surface-500 dark:text-surface-400'"
          >
            <Bot class="size-3.5 shrink-0" />
            <select
              :value="chatConversation.assistantMode"
              :disabled="assistantSwitching"
              class="cursor-pointer bg-transparent border-0 py-0.5 pr-1 text-[11px] font-medium focus:outline-none disabled:opacity-60"
              :class="chatConversation.assistantMode !== 'off' ? 'text-white [&>option]:text-surface-800' : 'text-surface-600 dark:text-surface-300 [&>option]:text-surface-800'"
              :title="t('dashboard.chat.modeLabel')"
              @change="changeAssistantMode"
            >
              <option v-for="m in assistantModes" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </span>
          <button
            class="cursor-pointer inline-flex items-center gap-1 text-xs text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
            :disabled="chatLoading"
            @click="loadChat()"
          >
            <RefreshCw class="size-3.5" :class="chatLoading ? 'animate-spin' : ''" />
          </button>
        </div>
      </div>

      <div
        v-if="chatSyncError"
        class="mb-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
      >
        {{ t('dashboard.chat.syncError') }}
      </div>

      <!-- Messages -->
      <div
        ref="chatScrollEl"
        class="h-[45vh] overflow-y-auto rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-surface-50 dark:bg-surface-900/40 p-3 space-y-2"
      >
        <div v-if="chatMessages.length === 0" class="text-center text-xs text-surface-400 py-10">
          {{ t('dashboard.chat.noMessages') }}
        </div>
        <div
          v-for="m in chatMessages"
          :key="m.id"
          class="flex"
          :class="m.direction === 'out' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm"
            :class="m.direction === 'out'
              ? (m.status === 'failed' ? 'bg-danger-600/80 text-white rounded-br-sm' : 'bg-brand-600 text-white rounded-br-sm')
              : 'bg-white dark:bg-surface-800 text-surface-800 dark:text-surface-100 rounded-bl-sm border border-surface-200/80 dark:border-surface-700/60'"
          >
            <p v-if="m.senderName && m.direction === 'in'" class="text-[11px] font-semibold mb-0.5 opacity-70">
              {{ m.senderName }}
            </p>
            <p v-else-if="m.senderType === 'agent'" class="text-[11px] font-semibold mb-0.5 opacity-80 inline-flex items-center gap-1">
              <Bot class="size-3" />{{ m.senderName || t('dashboard.chat.agentLabel') }}
            </p>
            <p v-if="m.body" class="whitespace-pre-wrap break-words">{{ m.body }}</p>
            <!-- Спринт 19: вложения Telegram (фото инлайн, остальное — ссылкой) -->
            <template v-for="(a, ai) in typedAttachments(m)" :key="ai">
              <a
                v-if="a.s3Key && isImageAttachment(a)"
                :href="attachmentUrl(m, ai)"
                target="_blank"
                rel="noopener"
                class="block mt-1.5"
              >
                <img
                  :src="attachmentUrl(m, ai)"
                  :alt="a.name || t('dashboard.chat.attachment')"
                  class="max-h-48 rounded-lg border border-black/5 dark:border-white/10"
                  loading="lazy"
                >
              </a>
              <a
                v-else-if="a.s3Key"
                :href="attachmentUrl(m, ai)"
                target="_blank"
                rel="noopener"
                class="mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium underline decoration-dotted underline-offset-2"
                :class="m.direction === 'out' ? 'text-white/90 hover:text-white' : 'text-brand-600 dark:text-brand-400 hover:text-brand-700'"
              >
                <Paperclip class="size-3.5 shrink-0" />
                {{ a.name || t('dashboard.chat.attachment') }}
              </a>
              <p v-else class="mt-1 text-xs opacity-70">{{ t('dashboard.chat.attachment') }}</p>
            </template>
            <p v-if="!m.body && typedAttachments(m).length === 0" class="whitespace-pre-wrap break-words">{{ t('dashboard.chat.attachment') }}</p>
            <p
              class="text-[10px] mt-1 tabular-nums"
              :class="m.direction === 'out' ? 'text-white/70 text-right' : 'text-surface-400 dark:text-surface-500'"
            >
              {{ formatChatTime(m.createdAt) }}<template v-if="m.status === 'failed'"> · {{ t('dashboard.chat.failed') }}</template>
            </p>
          </div>
        </div>
      </div>

      <!-- Чат 2.0: состояние черновика ассистента -->
      <div
        v-if="chatDraft?.status === 'generating'"
        class="mt-3 flex items-center gap-2 rounded-xl border border-brand-200/80 dark:border-brand-900/60 bg-brand-50/60 dark:bg-brand-950/30 px-3 py-2.5 text-xs text-brand-700 dark:text-brand-300"
      >
        <div class="size-3.5 rounded-full border-2 border-brand-300 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin shrink-0" />
        {{ t('dashboard.chat.draftGenerating') }}
      </div>
      <div
        v-else-if="chatDraft?.status === 'suggested'"
        class="mt-3 rounded-xl border border-brand-200/80 dark:border-brand-900/60 bg-brand-50/60 dark:bg-brand-950/30 p-3"
      >
        <p class="text-[11px] font-semibold text-brand-700 dark:text-brand-300 uppercase tracking-wider inline-flex items-center gap-1.5 mb-1.5">
          <Bot class="size-3.5" />
          {{ draftNeedsReview ? t('dashboard.chat.reviewTitle') : t('dashboard.chat.draftReadyTitle') }}
        </p>
        <p class="text-sm text-surface-800 dark:text-surface-100 whitespace-pre-wrap break-words">{{ chatDraft.body }}</p>
        <div class="mt-2.5 flex items-center gap-2">
          <button
            v-if="draftNeedsReview"
            class="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
            :disabled="draftResolving || !chatConversation.canWrite"
            @click="resolveDraft(chatDraft.id, 'approve')"
          >
            <Send class="size-3.5" />
            {{ t('dashboard.chat.reviewSend') }}
          </button>
          <button
            v-else
            class="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
            :disabled="draftResolving"
            @click="resolveDraft(chatDraft.id, 'consume')"
          >
            <Sparkles class="size-3.5" />
            {{ t('dashboard.chat.draftToComposer') }}
          </button>
          <button
            class="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800/60 disabled:opacity-50 transition-colors"
            :disabled="draftResolving"
            @click="resolveDraft(chatDraft.id, 'discard')"
          >
            {{ t('dashboard.chat.reviewDiscard') }}
          </button>
        </div>
      </div>

      <!-- Спринт 19.5: статус чата личного ТГ (Telegram Business) -->
      <div
        v-if="chatConversation.business"
        class="mt-3 rounded-lg px-3 py-2 text-xs"
        :class="!chatConversation.business.connected || !chatConversation.business.canReply || !chatConversation.business.windowOpen
          ? 'bg-warning-50 dark:bg-warning-950/30 text-warning-700 dark:text-warning-300'
          : 'bg-surface-100 dark:bg-surface-800/60 text-surface-500 dark:text-surface-400'"
      >
        <span class="font-semibold">{{ t('dashboard.chat.bizBadge') }}</span>
        <template v-if="!chatConversation.business.connected"> · {{ t('dashboard.chat.bizDisconnected') }}</template>
        <template v-else-if="!chatConversation.business.canReply"> · {{ t('dashboard.chat.bizNoReply') }}</template>
        <template v-else-if="!chatConversation.business.windowOpen"> · {{ t('dashboard.chat.bizWindowClosed') }}</template>
        <template v-else> · {{ t('dashboard.chat.bizWindowOpen') }}</template>
      </div>

      <!-- Composer -->
      <div class="mt-3">
        <div
          v-if="!chatConversation.canWrite"
          class="rounded-lg bg-surface-100 dark:bg-surface-800/60 px-3 py-2 text-xs text-surface-500 dark:text-surface-400"
        >
          {{ t('dashboard.chat.cannotWrite') }}<template v-if="chatConversation.canWriteReason"> ({{ chatConversation.canWriteReason }})</template>
        </div>
        <div v-else class="flex items-end gap-2">
          <textarea
            v-model="chatText"
            rows="2"
            :placeholder="t('dashboard.chat.placeholder')"
            class="flex-1 resize-none rounded-xl border border-surface-200/80 dark:border-surface-700/60 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            @keydown.enter.exact.prevent="sendChatMessage()"
          />
          <button
            class="cursor-pointer inline-flex items-center justify-center size-9 rounded-xl border border-surface-200/80 dark:border-surface-700/60 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/40 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 transition-colors"
            :disabled="chatSuggesting || !!chatDraft"
            :title="t('dashboard.chat.suggestReply')"
            @click="suggestAssistantReply()"
          >
            <Sparkles class="size-4" :class="chatSuggesting ? 'animate-pulse' : ''" />
          </button>
          <button
            class="cursor-pointer inline-flex items-center justify-center size-9 rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 transition-colors"
            :disabled="chatSending || !chatText.trim()"
            @click="sendChatMessage()"
          >
            <Send class="size-4" />
          </button>
        </div>
        <p v-if="chatSendError" class="mt-1.5 text-xs text-danger-600 dark:text-danger-400">
          {{ chatSendError }}
        </p>
        <p v-if="chatSuggestError" class="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          {{ chatSuggestError }}
        </p>
      </div>
    </div>
  </div>
</template>
