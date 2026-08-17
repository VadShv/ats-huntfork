/**
 * useTelegram — интеграция с Telegram через Bot API.
 *
 * Без новых npm-зависимостей: Bot API — это простой fetch к api.telegram.org.
 * Side panel запрашивает optional permission на https://api.telegram.org/*.
 *
 * Возможности:
 *  • connectBot(token) — проверка токена через getMe
 *  • addChannel(username) — получение инфо о канале через getChat
 *  • pollChannels() — long polling через getUpdates, фильтрация по каналам
 *  • parseMessage(text) — извлечение контактов и типа из текста сообщения
 *  • sendTelegram(handle, text) — deep link t.me/{handle}?text=...
 *  • exportContacts() — экспорт распарсенных контактов в CSV
 */
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useToast } from './useToast'
import { useHistory } from './useHistory'

const TG_API = 'https://api.telegram.org'

export type MessageType = 'vacancy' | 'resume' | 'contact' | 'general'

export interface TgChannel {
  id: string
  username: string
  title: string
  memberCount?: number
  addedAt: number
  lastUpdateId?: number
}

export interface ParsedMessage {
  id: string
  channelId: string
  channelTitle: string
  text: string
  timestamp: number
  type: MessageType
  contacts: {
    emails: string[]
    phones: string[]
    telegrams: string[]
    links: string[]
  }
  senderName?: string
}

export interface TgBotInfo {
  id: number
  username: string
  firstName: string
}

const TOKEN_KEY = 'hf:tg:token'
const CHANNELS_KEY = 'hf:tg:channels'
const MESSAGES_KEY = 'hf:tg:messages'

const botToken = ref<string>('')
const botInfo = ref<TgBotInfo | null>(null)
const connected = ref(false)
const connecting = ref(false)

const channels = ref<TgChannel[]>([])
const messages = ref<ParsedMessage[]>([])
const polling = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null
let loaded = false

export function useTelegram() {
  const { toast } = useToast()
  const { log } = useHistory()

  async function load() {
    if (loaded) return
    loaded = true
    try {
      const [tResult, cResult, mResult] = await chrome.storage.local.get([
        TOKEN_KEY,
        CHANNELS_KEY,
        MESSAGES_KEY,
      ])
      botToken.value = tResult[TOKEN_KEY] || ''
      channels.value = Array.isArray(cResult[CHANNELS_KEY]) ? cResult[CHANNELS_KEY] : []
      messages.value = Array.isArray(mResult[MESSAGES_KEY]) ? mResult[MESSAGES_KEY] : []
      if (botToken.value) {
        // Пробуем переподключиться
        await connectBot(botToken.value, true)
      }
    } catch {
      // storage недоступен
    }
  }

  function persistToken() {
    try { chrome.storage.local.set({ [TOKEN_KEY]: botToken.value }) } catch {}
  }

  function persistChannels() {
    try { chrome.storage.local.set({ [CHANNELS_KEY]: channels.value }) } catch {}
  }

  function persistMessages() {
    // Храним только последние 200 сообщений
    const trimmed = messages.value.slice(0, 200)
    try { chrome.storage.local.set({ [MESSAGES_KEY]: trimmed }) } catch {}
  }

  onMounted(() => { load() })
  onUnmounted(() => { stopPolling() })

  /** Запросить optional permission на api.telegram.org. */
  async function ensurePermission(): Promise<boolean> {
    try {
      const has = await chrome.permissions.contains({
        origins: ['https://api.telegram.org/*'],
      })
      if (has) return true
      const granted = await chrome.permissions.request({
        origins: ['https://api.telegram.org/*'],
      })
      return granted
    } catch {
      return false
    }
  }

  /** Вызов к Telegram Bot API. */
  async function tgCall(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const url = `${TG_API}/bot${botToken.value}/${method}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    const data = await resp.json()
    if (!data.ok) throw new Error(data.description || `Telegram API error: ${method}`)
    return data.result
  }

  /** Подключить бота по токену. */
  async function connectBot(token: string, silent = false): Promise<boolean> {
    if (connecting.value) return false
    connecting.value = true
    try {
      botToken.value = token
      const hasPerm = await ensurePermission()
      if (!hasPerm) {
        if (!silent) toast('Нужно разрешение на доступ к Telegram API', 'error')
        connecting.value = false
        return false
      }
      const me = await tgCall('getMe')
      botInfo.value = {
        id: me.id,
        username: me.username,
        firstName: me.first_name,
      }
      connected.value = true
      persistToken()
      log({
        type: 'telegram_connect',
        description: `Подключён бот @${me.username}`,
        meta: { botId: me.id },
      })
      if (!silent) toast(`Бот @${me.username} подключён`, 'success')
      return true
    } catch (err: any) {
      connected.value = false
      botInfo.value = null
      if (!silent) toast(`Ошибка: ${err?.message ?? 'неверный токен'}`, 'error')
      return false
    } finally {
      connecting.value = false
    }
  }

  /** Отключить бота. */
  function disconnectBot() {
    botToken.value = ''
    botInfo.value = null
    connected.value = false
    stopPolling()
    persistToken()
    toast('Бот отключён', 'default')
  }

  /** Добавить канал для отслеживания. */
  async function addChannel(username: string): Promise<boolean> {
    if (!connected.value) {
      toast('Сначала подключите бота', 'error')
      return false
    }
    const clean = username.replace(/^@/, '').trim()
    if (!clean) return false
    if (channels.value.some((c) => c.username === clean)) {
      toast('Канал уже добавлен', 'default')
      return false
    }
    try {
      const chat = await tgCall('getChat', { chat_id: `@${clean}` })
      const channel: TgChannel = {
        id: `${chat.id}`,
        username: clean,
        title: chat.title || clean,
        memberCount: chat.members_count,
        addedAt: Date.now(),
      }
      channels.value = [...channels.value, channel]
      persistChannels()
      toast(`Канал «${channel.title}» добавлен`, 'success')
      return true
    } catch (err: any) {
      toast(`Не удалось найти канал: ${err?.message ?? ''}`, 'error')
      return false
    }
  }

  /** Удалить канал. */
  function removeChannel(id: string) {
    channels.value = channels.value.filter((c) => c.id !== id)
    persistChannels()
  }

  /** Определить тип сообщения по ключевым словам. */
  function detectType(text: string): MessageType {
    const lower = text.toLowerCase()
    const vacancyWords = ['ищем', 'требуется', 'вакансия', 'нанимаем', 'открыта позиция', 'looking for', 'hiring', 'job']
    const resumeWords = ['резюме', 'ищу работу', 'откликаюсь', 'готов к переезду', 'cv', 'resume', 'looking for a job']
    const contactWords = ['контакт', 'рекомендую', 'знакомый', 'refer', 'recommend']
    if (vacancyWords.some((w) => lower.includes(w))) return 'vacancy'
    if (resumeWords.some((w) => lower.includes(w))) return 'resume'
    if (contactWords.some((w) => lower.includes(w))) return 'contact'
    return 'general'
  }

  /** Извлечение контактов из текста. */
  function extractContacts(text: string): ParsedMessage['contacts'] {
    const emails = new Set<string>()
    const phones = new Set<string>()
    const telegrams = new Set<string>()
    const links = new Set<string>()

    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) emails.add(m[0])
    for (const m of text.matchAll(/(?:\+7|\b8)[\s(-]?\d{3}[)\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g)) phones.add(m[0])
    for (const m of text.matchAll(/@([A-Za-z0-9_]{4,32})\b/g)) telegrams.add(`@${m[1]}`)
    for (const m of text.matchAll(/https?:\/\/(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,32})/g)) telegrams.add(`@${m[1]}`)
    for (const m of text.matchAll(/(https?:\/\/[^\s]+)/g)) links.add(m[0])

    return {
      emails: [...emails].slice(0, 10),
      phones: [...phones].slice(0, 10),
      telegrams: [...telegrams].slice(0, 10),
      links: [...links].slice(0, 20),
    }
  }

  /** Парсинг одного сообщения в структурированный формат. */
  function parseMessage(
    text: string,
    channelId: string,
    channelTitle: string,
    timestamp: number,
    senderName?: string,
    msgId?: number
  ): ParsedMessage {
    return {
      id: `tg_${channelId}_${msgId ?? Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      channelId,
      channelTitle,
      text: text.slice(0, 5000),
      timestamp,
      type: detectType(text),
      contacts: extractContacts(text),
      senderName,
    }
  }

  /** Опрос каналов через getUpdates. */
  async function pollOnce(): Promise<number> {
    if (!connected.value || channels.value.length === 0) return 0
    const trackedUsernames = new Set(channels.value.map((c) => c.username.toLowerCase()))
    let newCount = 0

    try {
      // Используем offset из последнего update_id
      const minOffset = channels.value
        .map((c) => c.lastUpdateId ?? 0)
        .reduce((a, b) => Math.max(a, b), 0)
      const updates = await tgCall('getUpdates', {
        offset: minOffset + 1,
        limit: 100,
        timeout: 0,
      })

      for (const update of updates) {
        const msg = update.message || update.channel_post
        if (!msg?.text) continue
        const chatUsername = (msg.chat?.username || '').toLowerCase()
        if (!trackedUsernames.has(chatUsername)) continue

        const channel = channels.value.find(
          (c) => c.username.toLowerCase() === chatUsername
        )
        if (!channel) continue

        // Проверяем дубликаты
        const msgKey = `${channel.id}_${update.update_id}`
        if (messages.value.some((m) => m.id.includes(`_${update.update_id}_`))) continue

        const parsed = parseMessage(
          msg.text,
          channel.id,
          channel.title,
          (msg.date || 0) * 1000,
          msg.from?.first_name || msg.from?.username,
          update.update_id
        )
        messages.value = [parsed, ...messages.value].slice(0, 200)
        channel.lastUpdateId = update.update_id
        newCount++
      }

      if (newCount > 0) {
        persistMessages()
        persistChannels()
        log({
          type: 'telegram_parse',
          description: `Получено ${newCount} новых сообщений из Telegram`,
          meta: { count: newCount },
        })
      }
    } catch (err) {
      // Тихо: сеть может быть нестабильна
    }
    return newCount
  }

  /** Запуск периодического опроса. */
  function startPolling() {
    if (polling.value) return
    polling.value = true
    pollOnce() // немедленный первый опрос
    pollTimer = setInterval(() => pollOnce(), 30000)
  }

  /** Остановка опроса. */
  function stopPolling() {
    polling.value = false
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  /** Отправка через deep link (открывает t.me). */
  function sendTelegram(handle: string, text: string): string {
    const clean = handle.replace(/^@/, '').trim()
    const url = `https://t.me/${clean}?text=${encodeURIComponent(text)}`
    log({
      type: 'outreach_send',
      description: `Отправлено сообщение в Telegram — @${clean}`,
      url,
      meta: { channel: 'telegram' },
    })
    return url
  }

  /** Экспорт контактов в CSV. */
  function exportContactsCsv(): string {
    const rows = ['channel,type,telegram,email,phone,link,date']
    for (const msg of messages.value) {
      const date = new Date(msg.timestamp).toLocaleDateString('ru-RU')
      const allContacts = [
        ...msg.contacts.telegrams.map((t) => ['telegram', t]),
        ...msg.contacts.emails.map((e) => ['email', e]),
        ...msg.contacts.phones.map((p) => ['phone', p]),
        ...msg.contacts.links.map((l) => ['link', l]),
      ] as [string, string][]
      if (allContacts.length === 0) {
        rows.push([msg.channelTitle, msg.type, '', '', '', '', date].map(escapeCsv).join(','))
      } else {
        for (const [kind, value] of allContacts) {
          rows.push(
            [msg.channelTitle, msg.type, kind === 'telegram' ? value : '', kind === 'email' ? value : '', kind === 'phone' ? value : '', kind === 'link' ? value : '', date]
              .map(escapeCsv)
              .join(',')
          )
        }
      }
    }
    return rows.join('\n')
  }

  function escapeCsv(val: string): string {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`
    }
    return val
  }

  /** Очистить сообщения. */
  function clearMessages() {
    messages.value = []
    persistMessages()
    toast('Лента очищена', 'default')
  }

  const hasContacts = computed(() =>
    messages.value.some((m) =>
      m.contacts.emails.length > 0 ||
      m.contacts.phones.length > 0 ||
      m.contacts.telegrams.length > 0
    )
  )

  const messagesByType = computed(() => {
    const groups: Record<MessageType, ParsedMessage[]> = {
      vacancy: [], resume: [], contact: [], general: [],
    }
    for (const m of messages.value) groups[m.type].push(m)
    return groups
  })

  function typeLabel(t: MessageType): string {
    if (t === 'vacancy') return 'Вакансия'
    if (t === 'resume') return 'Резюме'
    if (t === 'contact') return 'Контакт'
    return 'Общее'
  }

  return {
    botToken,
    botInfo,
    connected,
    connecting,
    channels,
    messages,
    polling,
    hasContacts,
    messagesByType,
    load,
    connectBot,
    disconnectBot,
    addChannel,
    removeChannel,
    pollOnce,
    startPolling,
    stopPolling,
    sendTelegram,
    exportContactsCsv,
    clearMessages,
    detectType,
    extractContacts,
    typeLabel,
  }
}
