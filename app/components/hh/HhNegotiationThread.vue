<script setup lang="ts">
import { Loader2, Send, AlertCircle } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: boolean
  negotiationId: string
  candidateName?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const toast = useToast()

const isOpen = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

interface HhMessage {
  id?: string
  text?: string
  created_at?: string
  author?: { type?: string, [key: string]: unknown }
  [key: string]: unknown
}

const threadKey = computed(() => `hh-thread-${props.negotiationId}`)
const threadUrl = computed(() => `/api/hh/negotiations/${props.negotiationId}/messages`)

const { data: messages, status, error, refresh } = useFetch<HhMessage[]>(() => threadUrl.value, {
  key: threadKey.value,
  immediate: false,
  default: () => [],
})

// Загружаем сообщения при открытии модалки
watch(isOpen, async (open) => {
  if (open) {
    await refresh()
    await nextTick()
    scrollToBottom()
  }
})

const isLoading = computed(() => status.value === 'pending')

function stripHtml(html: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function isIncoming(msg: HhMessage): boolean {
  return msg.author?.type === 'applicant'
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const messagesContainer = useTemplateRef<HTMLElement>('messagesContainer')

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

watch(() => messages.value?.length, async () => {
  await nextTick()
  scrollToBottom()
})

// ── Reply ──
const replyText = ref('')
const isSending = ref(false)
const canSend = computed(() => replyText.value.trim().length > 0 && !isSending.value)

async function sendReply() {
  if (!canSend.value) return
  isSending.value = true
  try {
    await $fetch(threadUrl.value, {
      method: 'POST',
      body: { messageText: replyText.value.trim() },
    })
    replyText.value = ''
    await refresh()
    await nextTick()
    scrollToBottom()
    toast.success('Сообщение отправлено')
  }
  catch (err: any) {
    toast.error('Не удалось отправить сообщение', {
      message: err?.data?.statusMessage ?? err?.message,
    })
  }
  finally {
    isSending.value = false
  }
}

function close() {
  isOpen.value = false
}
</script>

<template>
  <UiModal
    :model-value="modelValue"
    size="lg"
    @update:model-value="isOpen = $event"
  >
    <template #header>
      <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">
        Переговоры hh.ru
      </h2>
      <p v-if="candidateName" class="mt-0.5 text-sm text-surface-500 dark:text-surface-400">
        {{ candidateName }}
      </p>
    </template>

    <!-- Error -->
    <div
      v-if="error"
      class="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 dark:bg-danger-950/30 p-3 text-sm text-danger-700 dark:text-danger-400"
    >
      <AlertCircle class="size-4 shrink-0 mt-0.5" />
      <span>Не удалось загрузить переписку. Попробуйте позже.</span>
    </div>

    <!-- Loading -->
    <div v-else-if="isLoading" class="flex items-center justify-center gap-2 py-12 text-surface-400">
      <Loader2 class="size-5 animate-spin" />
      Загрузка переписки…
    </div>

    <!-- Thread -->
    <div v-else ref="messagesContainer" class="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
      <div
        v-for="msg in messages"
        :key="msg.id ?? msg.created_at"
        class="flex"
        :class="isIncoming(msg) ? 'justify-start' : 'justify-end'"
      >
        <div
          class="max-w-[80%] rounded-lg px-3 py-2 text-sm"
          :class="isIncoming(msg)
            ? 'bg-surface-100 dark:bg-surface-800 text-surface-800 dark:text-surface-200'
            : 'bg-brand-600 text-white'"
        >
          <div
            v-if="msg.text"
            class="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap break-words"
          >{{ stripHtml(msg.text) }}</div>
          <p v-else class="italic opacity-60">(пустое сообщение)</p>
          <span
            class="mt-1 block text-[10px] opacity-60"
            :class="isIncoming(msg) ? '' : 'text-white'"
          >
            {{ formatTime(msg.created_at) }}
          </span>
        </div>
      </div>

      <p v-if="messages.length === 0" class="py-8 text-center text-sm text-surface-400">
        Сообщений пока нет
      </p>
    </div>

    <template #footer>
      <div class="flex w-full items-end gap-2">
        <UiTextarea
          v-model="replyText"
          :rows="2"
          placeholder="Введите сообщение кандидату…"
          class="flex-1"
        />
        <UiButton
          variant="primary"
          :icon-left="Send"
          :disabled="!canSend"
          :loading="isSending"
          @click="sendReply"
        >
          Отправить
        </UiButton>
      </div>
    </template>
  </UiModal>
</template>
