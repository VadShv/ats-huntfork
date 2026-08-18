/**
 * useConversations — сохранение и управление переписками чата.
 *
 * Хранит переписки в chrome.storage.local (ключ hf:conversations).
 * Лимит: 50 переписок, каждая до 200 сообщений (FIFO).
 */
import { ref, watch } from 'vue'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  jobId?: string
  jobTitle?: string
  sourceUrl?: string
  site?: string
}

const STORAGE_KEY = 'hf:conversations'
const MAX_CONVERSATIONS = 50
const MAX_MESSAGES = 200

const conversations = ref<Conversation[]>([])
const activeConversationId = ref<string | null>(null)
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function useConversations() {
  async function load() {
    if (loaded) return
    loaded = true
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY)
      const stored = result[STORAGE_KEY]
      if (Array.isArray(stored)) conversations.value = stored
    } catch {
      // storage недоступен
    }
  }

  function persist() {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: conversations.value })
    } catch {}
  }

  /** Список переписок, отсортированный по updatedAt (новые сверху). */
  function listConversations(): Conversation[] {
    return [...conversations.value].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** Активная переписка. */
  function getActive(): Conversation | null {
    if (!activeConversationId.value) return null
    return conversations.value.find((c) => c.id === activeConversationId.value) ?? null
  }

  /** Создать новую пустую переписку. */
  function createConversation(meta?: Partial<Pick<Conversation, 'jobId' | 'jobTitle' | 'sourceUrl' | 'site'>>): Conversation {
    const conv: Conversation = {
      id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: 'Новый чат',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...meta,
    }
    conversations.value = [conv, ...conversations.value].slice(0, MAX_CONVERSATIONS)
    activeConversationId.value = conv.id
    persist()
    return conv
  }

  /** Загрузить переписку по ID — возвращает её сообщения. */
  function loadConversation(id: string): ChatMessage[] {
    const conv = conversations.value.find((c) => c.id === id)
    if (!conv) return []
    activeConversationId.value = id
    return conv.messages
  }

  /** Сохранить сообщения в активную переписку (debounced автосейв). */
  function saveActive(messages: ChatMessage[], meta?: Partial<Pick<Conversation, 'title' | 'jobId' | 'jobTitle' | 'sourceUrl' | 'site'>>) {
    if (!activeConversationId.value) return
    const conv = conversations.value.find((c) => c.id === activeConversationId.value)
    if (!conv) return

    conv.messages = messages.slice(-MAX_MESSAGES)
    conv.updatedAt = Date.now()
    if (meta) Object.assign(conv, meta)

    // Авто-title из первого user-сообщения
    if ((!conv.title || conv.title === 'Новый чат') && messages.length > 0) {
      const firstUser = messages.find((m) => m.role === 'user')
      if (firstUser) {
        conv.title = firstUser.content.slice(0, 40).trim() + (firstUser.content.length > 40 ? '…' : '')
      }
    }

    // Debounced persist
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => persist(), 1500)
  }

  /** Удалить переписку. */
  function deleteConversation(id: string) {
    conversations.value = conversations.value.filter((c) => c.id !== id)
    if (activeConversationId.value === id) activeConversationId.value = null
    persist()
  }

  /** Переименовать переписку. */
  function renameConversation(id: string, title: string) {
    const conv = conversations.value.find((c) => c.id === id)
    if (conv) {
      conv.title = title
      conv.updatedAt = Date.now()
      persist()
    }
  }

  /** Очистить все переписки. */
  function clearAll() {
    conversations.value = []
    activeConversationId.value = null
    persist()
  }

  return {
    conversations,
    activeConversationId,
    load,
    listConversations,
    getActive,
    createConversation,
    loadConversation,
    saveActive,
    deleteConversation,
    renameConversation,
    clearAll,
  }
}
