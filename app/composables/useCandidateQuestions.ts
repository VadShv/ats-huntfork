import type { MaybeRefOrGetter } from 'vue'

export interface CandidateQuestionItem {
  id: string
  setId: string
  text: string
  listenFor: string | null
  category: string
  origin: 'from_job_bank' | 'risk_derived' | 'manual'
  sourceRef: string | null
  rationale: string | null
  askStatus: 'pending' | 'asked' | 'skipped'
  answerNote: string | null
  displayOrder: number
}

export interface CandidateQuestionSet {
  id: string
  applicationId: string
  status: 'draft' | 'ready'
  basedOnResumeRiskId: string | null
  generatedAt: string
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

  async function generate(perBankCategory = 3) {
    const res = await guard(() => $fetch(`/api/applications/${id.value}/question-set/generate`, {
      method: 'POST', body: { perBankCategory },
    }))
    await refresh()
    return res
  }

  async function addItem(payload: { text: string, category?: string, listenFor?: string }) {
    const res = await guard(() => $fetch(`/api/applications/${id.value}/question-set/items`, { method: 'POST', body: payload }))
    await refresh()
    return res
  }

  async function updateItem(itemId: string, payload: Partial<Pick<CandidateQuestionItem, 'text' | 'category' | 'listenFor' | 'askStatus' | 'answerNote' | 'displayOrder'>>) {
    const res = await guard(() => $fetch(`/api/applications/${id.value}/question-set/items/${itemId}`, { method: 'PATCH', body: payload }))
    await refresh()
    return res
  }

  async function deleteItem(itemId: string) {
    await guard(() => $fetch(`/api/applications/${id.value}/question-set/items/${itemId}`, { method: 'DELETE' }))
    await refresh()
  }

  return {
    set: computed(() => data.value?.set ?? null),
    items: computed(() => data.value?.items ?? []),
    status, error, refresh,
    generate, addItem, updateItem, deleteItem,
  }
}
