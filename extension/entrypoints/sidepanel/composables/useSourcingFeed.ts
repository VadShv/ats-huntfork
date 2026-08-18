/**
 * useSourcingFeed — лента кандидатов сорсинга из АТС.
 *
 * Читает /api/jobs/:jobId/sourcing-candidates (через background-роут sourcingFeed),
 * поддерживает фильтр по статусу, infinite scroll, действия (approve/reject/note)
 * и импорт в воронку (тратит квоту hh.ru).
 *
 * Не делает AI-скоринг — score/scoreRationale в схеме есть, но не заполняется.
 */
import { ref, computed } from 'vue'

export type SourcingState = 'new' | 'active' | 'approved' | 'rejected' | 'imported' | 'contacted' | 'reviewed'

export interface SourcingSnapshot {
  title: string | null
  areaName: string | null
  salaryAmount: number | null
  salaryCurrency: string | null
  age: number | null
  experienceYears: number | null
  lastCompany: string | null
  lastPosition: string | null
  skills: string[]
  educationLevel: string | null
  workFormat: string[]
  employmentForm: string[]
  relocation: { type: string | null } | null
  experience: Array<{
    company: string | null
    position: string | null
    start: string | null
    end: string | null
    durationMonths: number | null
  }>
}

export interface ExistingCandidate {
  id: string
  firstName: string
  lastName: string
  lastApplicationSource: string | null
  applicationCount: number
  hasApplicationOnThisJob: boolean
  lastApplicationCreatedAt: string | null
}

export interface SourcingCandidate {
  id: string
  savedSearchId: string
  hhResumeId: string
  snapshot: SourcingSnapshot
  score: number | null
  scoreRationale: string | null
  state: string
  applicationId: string | null
  reviewNote: string | null
  firstSeenAt: string
  lastSeenAt: string
  existingCandidate: ExistingCandidate | null
}

type ActionState = 'idle' | 'pending' | 'ok' | 'err'

const LIMIT = 25

// Singleton-стейт — один экземпляр на панель
const items = ref<SourcingCandidate[]>([])
const stateFilter = ref<SourcingState>('active')
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const hasMore = ref(false)
const totalLoaded = ref(0)
const currentJobId = ref('')
const actionStates = ref<Record<string, { action: string, state: ActionState, msg: string }>>({})

function send(msg: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, message: chrome.runtime.lastError.message })
      }
      else resolve(resp)
    })
  })
}

async function loadFeed(jobId: string, reset = true) {
  if (!jobId) {
    items.value = []
    hasMore.value = false
    currentJobId.value = ''
    return
  }
  currentJobId.value = jobId
  if (reset) {
    loading.value = true
    error.value = ''
    items.value = []
    totalLoaded.value = 0
  }
  else {
    loadingMore.value = true
  }

  try {
    const resp = await send({
      type: 'sourcingFeed',
      jobId,
      state: stateFilter.value,
      limit: LIMIT,
      offset: totalLoaded.value,
    })
    if (!resp.ok) {
      error.value = resp.message || 'Не удалось загрузить ленту'
      if (reset) items.value = []
      hasMore.value = false
      return
    }
    const batch: SourcingCandidate[] = resp.data?.candidates ?? []
    if (reset) {
      items.value = batch
    }
    else {
      items.value = [...items.value, ...batch]
    }
    totalLoaded.value += batch.length
    hasMore.value = batch.length === LIMIT
  }
  catch (err: any) {
    error.value = err?.message || 'Ошибка загрузки ленты'
  }
  finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value || !currentJobId.value) return
  await loadFeed(currentJobId.value, false)
}

async function refresh() {
  if (currentJobId.value) await loadFeed(currentJobId.value, true)
}

function setStateFilter(s: SourcingState) {
  if (stateFilter.value === s) return
  stateFilter.value = s
  if (currentJobId.value) loadFeed(currentJobId.value, true)
}

function setActionState(id: string, action: string, state: ActionState, msg = '') {
  actionStates.value = { ...actionStates.value, [id]: { action, state, msg } }
}

async function applyAction(id: string, action: 'approve' | 'reject' | 'markReviewed', note?: string) {
  setActionState(id, action, 'pending')
  try {
    const resp = await send({ type: 'sourcingAction', id, action, note })
    if (!resp.ok) {
      setActionState(id, action, 'err', resp.message || 'Ошибка')
      return false
    }
    // Локально обновляем state
    const idx = items.value.findIndex(i => i.id === id)
    if (idx >= 0) {
      const stateMap = { approve: 'approved', reject: 'rejected', markReviewed: 'reviewed' } as const
      const updated = { ...items.value[idx]!, state: resp.data?.state ?? stateMap[action] }
      if (note !== undefined) updated.reviewNote = note
      items.value = [...items.value.slice(0, idx), updated, ...items.value.slice(idx + 1)]
    }
    setActionState(id, action, 'ok')
    return true
  }
  catch (err: any) {
    setActionState(id, action, 'err', err?.message || 'Ошибка')
    return false
  }
}

async function importToPipeline(id: string) {
  setActionState(id, 'import', 'pending')
  try {
    const resp = await send({ type: 'sourcingImport', id })
    if (!resp.ok) {
      setActionState(id, 'import', 'err', resp.message || 'Ошибка импорта')
      return false
    }
    const idx = items.value.findIndex(i => i.id === id)
    if (idx >= 0) {
      const updated = {
        ...items.value[idx]!,
        state: 'imported',
        applicationId: resp.data?.applicationId ?? items.value[idx]!.applicationId,
      }
      items.value = [...items.value.slice(0, idx), updated, ...items.value.slice(idx + 1)]
    }
    setActionState(id, 'import', 'ok')
    return true
  }
  catch (err: any) {
    setActionState(id, 'import', 'err', err?.message || 'Ошибка импорта')
    return false
  }
}

const counts = computed(() => {
  const c = { new: 0, approved: 0, rejected: 0, imported: 0, reviewed: 0 }
  for (const it of items.value) {
    if (it.state in c) (c as any)[it.state]++
  }
  return c
})

export function useSourcingFeed() {
  return {
    items, stateFilter, loading, loadingMore, error, hasMore, currentJobId,
    actionStates, counts,
    loadFeed, loadMore, refresh, setStateFilter,
    applyAction, importToPipeline,
  }
}
