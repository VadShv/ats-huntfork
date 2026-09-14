import type { MaybeRefOrGetter } from 'vue'

export type ItemPriority = 'must_ask' | 'should_ask' | 'optional'
export type CareElement = 'context' | 'action' | 'result' | 'evaluate'

export interface CandidateQuestionItem {
  id: string
  setId: string
  text: string
  listenFor: string | null
  category: string
  origin: 'from_job_bank' | 'risk_derived' | 'manual' | 'personalized'
  sourceRef: string | null
  rationale: string | null
  askStatus: 'pending' | 'asked' | 'skipped'
  answerNote: string | null
  parentItemId: string | null
  careElement: CareElement | null
  priority: ItemPriority
  topicId: string | null
  expectedEvidence: string[]
  greenFlags: string[]
  redFlags: string[]
  isPersonalized: boolean
  originalText: string | null
  displayOrder: number
}

/** Вопрос с вложенными probe (дерево). */
export interface CandidateQuestionNode extends CandidateQuestionItem {
  probes: CandidateQuestionItem[]
}

export interface CandidateQuestionSet {
  id: string
  applicationId: string
  status: 'draft' | 'ready'
  basedOnResumeRiskId: string | null
  generatedAt: string
  version: number
  isSnapshot: boolean
  confirmedAt: string | null
  personalizedAt: string | null
  isStale: boolean
  budgetMax: number
}

/**
 * Per-candidate interview question set on an application (Этап 4).
 */
export function useCandidateQuestions(applicationId: MaybeRefOrGetter<string>) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()
  const id = computed(() => toValue(applicationId))

  const { data, status, error, refresh } = useFetch<{ set: CandidateQuestionSet | null, items: CandidateQuestionItem[] }>(
    () => `/api/applications/${id.value}/question-set`,
    {
      key: computed(() => `cand-qset-${id.value}`),
      headers: useRequestHeaders(['cookie']),
      default: () => ({ set: null, items: [] }),
    },
  )

  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn() }
    catch (err) { handlePreviewReadOnlyError(err); throw err }
  }

  const toast = useToast()

  async function generate(perBankCategory = 3, budgetMax = 15) {
    const res = await guard(() => $fetch(`/api/applications/${id.value}/question-set/generate`, {
      method: 'POST', body: { perBankCategory, budgetMax },
    }))
    await refresh()
    return res
  }

  const personalizing = ref(false)
  async function personalize() {
    personalizing.value = true
    try {
      const res = await guard<{ personalized: boolean, message?: string }>(() => $fetch(
        `/api/applications/${id.value}/question-set/personalize`, { method: 'POST', body: {} },
      ))
      if (res.personalized) toast.success('Опросник персонализирован')
      else toast.warning(res.message ?? 'Персонализация недоступна, показан базовый опросник')
      await refresh()
      return res
    }
    catch { toast.error('Не удалось персонализировать'); throw new Error('personalize failed') }
    finally { personalizing.value = false }
  }

  async function confirm() {
    const res = await guard(() => $fetch(`/api/applications/${id.value}/question-set/confirm`, { method: 'POST' }))
    toast.success('Опросник зафиксирован')
    await refresh()
    return res
  }

  async function addItem(payload: { text: string, category?: string, listenFor?: string }) {
    const res = await guard(() => $fetch(`/api/applications/${id.value}/question-set/items`, { method: 'POST', body: payload }))
    await refresh()
    return res
  }

  async function updateItem(itemId: string, payload: Partial<Pick<CandidateQuestionItem, 'text' | 'category' | 'listenFor' | 'askStatus' | 'answerNote' | 'priority' | 'displayOrder'>>) {
    const res = await guard(() => $fetch(`/api/applications/${id.value}/question-set/items/${itemId}`, { method: 'PATCH', body: payload }))
    await refresh()
    return res
  }

  async function deleteItem(itemId: string) {
    await guard(() => $fetch(`/api/applications/${id.value}/question-set/items/${itemId}`, { method: 'DELETE' }))
    await refresh()
  }

  const allItems = computed<CandidateQuestionItem[]>(() => data.value?.items ?? [])

  // Дерево: основные вопросы (parentItemId=null) + probe внутри.
  const tree = computed<CandidateQuestionNode[]>(() => {
    const items = allItems.value
    const byOrder = (a: CandidateQuestionItem, b: CandidateQuestionItem) => a.displayOrder - b.displayOrder
    const mains = items.filter((i: CandidateQuestionItem) => !i.parentItemId).sort(byOrder)
    return mains.map((m: CandidateQuestionItem) => ({
      ...m,
      probes: items.filter((i: CandidateQuestionItem) => i.parentItemId === m.id).sort(byOrder),
    }))
  })

  return {
    set: computed(() => data.value?.set ?? null),
    items: allItems,
    tree,
    personalizing,
    status, error, refresh,
    generate, personalize, confirm, addItem, updateItem, deleteItem,
  }
}
