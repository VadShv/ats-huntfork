import type { MaybeRefOrGetter } from 'vue'

export type InterviewQuestionCategory =
  | 'hard_skill' | 'soft_skill' | 'experience' | 'motivation'
  | 'culture' | 'logistics' | 'risk_probe' | 'other'

export interface InterviewQuestion {
  id: string
  jobId: string
  text: string
  category: InterviewQuestionCategory
  rationale: string | null
  goodAnswer: string | null
  source: 'ai_generated' | 'manual' | 'edited'
  displayOrder: number
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Composable for the job interview-question bank (Этап 2).
 */
export function useInterviewQuestions(jobId: MaybeRefOrGetter<string>) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()
  const id = computed(() => toValue(jobId))

  const { data: questions, status, error, refresh } = useFetch<InterviewQuestion[]>(
    () => `/api/jobs/${id.value}/interview-questions`,
    {
      key: computed(() => `job-iq-${id.value}`),
      headers: useRequestHeaders(['cookie']),
      default: () => [],
    },
  )

  const { data: prompt, refresh: refreshPrompt } = useFetch<{ promptText: string, lastGeneratedAt: string | null } | null>(
    () => `/api/jobs/${id.value}/interview-questions/prompt`,
    {
      key: computed(() => `job-iq-prompt-${id.value}`),
      headers: useRequestHeaders(['cookie']),
      default: () => null,
    },
  )

  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    }
    catch (err) {
      handlePreviewReadOnlyError(err)
      throw err
    }
  }

  async function generate(payload: { promptText: string, count?: number }) {
    const res = await guard(() => $fetch(`/api/jobs/${id.value}/interview-questions/generate`, {
      method: 'POST',
      body: payload,
    }))
    await refresh()
    await refreshPrompt()
    return res
  }

  async function addQuestion(payload: { text: string, category?: string, rationale?: string, goodAnswer?: string }) {
    const created = await guard(() => $fetch(`/api/jobs/${id.value}/interview-questions`, { method: 'POST', body: payload }))
    await refresh()
    return created
  }

  async function updateQuestion(questionId: string, payload: Partial<Pick<InterviewQuestion, 'text' | 'category' | 'rationale' | 'goodAnswer' | 'displayOrder' | 'isArchived'>>) {
    const updated = await guard(() => $fetch(`/api/jobs/${id.value}/interview-questions/${questionId}`, { method: 'PATCH', body: payload }))
    await refresh()
    return updated
  }

  async function deleteQuestion(questionId: string) {
    await guard(() => $fetch(`/api/jobs/${id.value}/interview-questions/${questionId}`, { method: 'DELETE' }))
    await refresh()
  }

  async function savePrompt(promptText: string) {
    await guard(() => $fetch(`/api/jobs/${id.value}/interview-questions/prompt`, { method: 'PUT', body: { promptText } }))
    await refreshPrompt()
  }

  return {
    questions, prompt, status, error, refresh,
    generate, addQuestion, updateQuestion, deleteQuestion, savePrompt,
  }
}
