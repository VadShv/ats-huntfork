/**
 * useQueue — очередь профилей для пакетной обработки.
 *
 * Рекрутер листает выдачу и складывает профили в очередь одним хоткеем,
 * не открывая каждого. Панель копит их, потом обрабатывает пачкой.
 *
 * Хранится в chrome.storage.local (ключ hf:queue) — переживает перезагрузку.
 */
import { ref, watch, onMounted } from 'vue'
import { computed } from 'vue'
import { useToast } from './useToast'

export interface QueueItem {
  id: string
  url: string
  resumeId?: string
  source: string
  title?: string
  addedAt: number
  status: 'pending' | 'processing' | 'done' | 'error'
  note?: string
  tags?: string[]
}

const STORAGE_KEY = 'hf:queue'

/** Синглтон-стейт (один экземпляр на панель). */
const queue = ref<QueueItem[]>([])
let loaded = false

export function useQueue() {
  const { toast } = useToast()

  /** Загрузка из chrome.storage.local. */
  async function load() {
    if (loaded) return
    loaded = true
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY)
      const stored = result[STORAGE_KEY]
      if (Array.isArray(stored)) queue.value = stored
    } catch {
      // storage может быть недоступен в некоторых контекстах
    }
  }

  /** Автосохранение при изменении. */
  function persist() {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: queue.value })
    } catch {
      // ignore
    }
  }

  onMounted(() => {
    load()
    watch(queue, persist, { deep: true })
  })

  /** Добавить текущий профиль в очередь. */
  function add(item: Omit<QueueItem, 'id' | 'addedAt' | 'status'>): boolean {
    // Не добавляем дубликаты по URL.
    if (queue.value.some((q) => q.url === item.url)) {
      toast('Уже в очереди', 'info')
      return false
    }
    const newItem: QueueItem = {
      ...item,
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      addedAt: Date.now(),
      status: 'pending',
    }
    queue.value = [newItem, ...queue.value]
    toast('Добавлен в очередь', 'success')
    return true
  }

  /** Удалить элемент. */
  function remove(id: string) {
    queue.value = queue.value.filter((q) => q.id !== id)
  }

  /** Очистить всю очередь. */
  function clear() {
    queue.value = []
  }

  /** Очистить только обработанные. */
  function clearDone() {
    queue.value = queue.value.filter((q) => q.status !== 'done' && q.status !== 'error')
  }

  /** Отметить элемент как обработанный. */
  function setStatus(id: string, status: QueueItem['status']) {
    const item = queue.value.find((q) => q.id === id)
    if (item) item.status = status
  }

  /** Установить заметку для элемента очереди. */
  function setNote(id: string, note: string) {
    const item = queue.value.find((q) => q.id === id)
    if (item) item.note = note
  }

  /** Добавить тег к элементу очереди. */
  function addTag(id: string, tag: string) {
    const t = tag.trim().toLowerCase()
    if (!t) return
    const item = queue.value.find((q) => q.id === id)
    if (!item) return
    if (!item.tags) item.tags = []
    if (!item.tags.includes(t)) item.tags.push(t)
  }

  /** Удалить тег у элемента очереди. */
  function removeTag(id: string, tag: string) {
    const item = queue.value.find((q) => q.id === id)
    if (!item?.tags) return
    item.tags = item.tags.filter((t) => t !== tag)
  }

  /** Все уникальные теги в очереди. */
  const allTags = computed(() => {
    const set = new Set<string>()
    queue.value.forEach((q) => q.tags?.forEach((t) => set.add(t)))
    return Array.from(set).sort()
  })

  /** Экспорт очереди в CSV. */
  function exportCsv(): string {
    const headers = ['Имя', 'URL', 'Источник', 'Статус', 'Теги', 'Заметка', 'Добавлен']
    const rows = queue.value.map((q) => {
      const name = q.name || ''
      const tags = (q.tags ?? []).join('; ')
      const note = (q.note ?? '').replace(/"/g, '""')
      const date = new Date(q.addedAt).toLocaleString('ru-RU')
      return [name, q.url, q.source, q.status, tags, note, date]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    })
    return [headers.join(','), ...rows].join('\n')
  }

  /** Количество ожидающих. */
  const pendingCount = () => queue.value.filter((q) => q.status === 'pending').length
  const totalCount = () => queue.value.length

  return {
    queue,
    add,
    remove,
    clear,
    clearDone,
    setStatus,
    setNote,
    addTag,
    removeTag,
    allTags,
    exportCsv,
    pendingCount,
    totalCount,
    load,
  }
}
