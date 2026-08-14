<script setup lang="ts">
/**
 * Переиспользуемая панель чата с кандидатом (Спринт 18).
 *
 * Единый компонент для всех мест, где показывается отклик:
 * сайдбар кандидата, полная страница отклика, drawer'ы (воронка, списки).
 * MVP-канал — hh.ru (sync-on-read). Поллинг 30с только пока компонент
 * смонтирован и вкладка браузера видима.
 */
import { Bot, MessageSquare, RefreshCw, Send, Sparkles } from 'lucide-vue-next'

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
  canWrite: boolean
  canWriteReason: string | null
  unreadCount: number
  assistantMode: string
}

const chatConversation = ref<ChatConversation | null>(null)
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
    }>(`/api/applications/${props.applicationId}/conversations`)
    const prevCount = chatMessages.value.length
    chatConversation.value = res.conversation
    chatReason.value = res.reason ?? null
    chatSyncError.value = res.syncError ?? null
    chatMessages.value = res.messages ?? []
    chatLoaded.value = true
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
    track('chat_message_sent', { channel: 'hh' })
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

/** «✨ Предложить ответ» — черновик от ассистента в композер (суфлёр, 18.5). */
async function suggestAssistantReply() {
  const conv = chatConversation.value
  if (!conv || chatSuggesting.value || !conv.canWrite) return
  chatSuggesting.value = true
  chatSuggestError.value = null
  try {
    const res = await $fetch<{ text: string }>(`/api/conversations/${conv.id}/suggest`, { method: 'POST' })
    chatText.value = res.text
    track('chat_assistant_suggest', { channel: 'hh' })
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

/** Переключатель «Передать боту / Забрать у бота» per-диалог. */
async function toggleAssistantMode() {
  const conv = chatConversation.value
  if (!conv || assistantSwitching.value) return
  const next = conv.assistantMode === 'off' ? 'copilot' : 'off'
  assistantSwitching.value = true
  try {
    await $fetch(`/api/conversations/${conv.id}/assistant`, { method: 'PATCH', body: { mode: next } })
    conv.assistantMode = next
    track('chat_assistant_mode', { mode: next })
  }
  catch {
    // молча — состояние не поменялось
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
  chatText.value = ''
  chatLoaded.value = false
  loadChat()
})

onMounted(() => {
  loadChat()
  startChatPolling()
})

onBeforeUnmount(stopChatPolling)
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
    </div>

    <!-- Chat -->
    <div v-else class="flex flex-col">
      <div class="flex items-center justify-between mb-2">
        <span class="inline-flex items-center gap-1.5 text-xs font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider">
          <MessageSquare class="size-3.5" />
          {{ t('dashboard.chat.viaHh') }}
        </span>
        <div class="flex items-center gap-2">
          <button
            class="cursor-pointer inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
            :class="chatConversation.assistantMode !== 'off'
              ? 'bg-brand-600 text-white hover:bg-brand-700'
              : 'bg-surface-100 dark:bg-surface-800/60 text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'"
            :disabled="assistantSwitching"
            :title="chatConversation.assistantMode !== 'off' ? t('dashboard.chat.assistantTakeOver') : t('dashboard.chat.assistantHandOff')"
            @click="toggleAssistantMode()"
          >
            <Bot class="size-3.5" />
            {{ chatConversation.assistantMode !== 'off' ? t('dashboard.chat.assistantOn') : t('dashboard.chat.assistantOff') }}
          </button>
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
            <p class="whitespace-pre-wrap break-words">{{ m.body ?? t('dashboard.chat.attachment') }}</p>
            <p
              class="text-[10px] mt-1 tabular-nums"
              :class="m.direction === 'out' ? 'text-white/70 text-right' : 'text-surface-400 dark:text-surface-500'"
            >
              {{ formatChatTime(m.createdAt) }}<template v-if="m.status === 'failed'"> · {{ t('dashboard.chat.failed') }}</template>
            </p>
          </div>
        </div>
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
            :disabled="chatSuggesting"
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
