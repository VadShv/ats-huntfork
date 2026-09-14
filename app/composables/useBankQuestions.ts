import type { MaybeRefOrGetter } from 'vue'

export type BankQuestionType =
  | 'behavioral' | 'situational' | 'motivational' | 'factual' | 'verification'
  | 'reflective' | 'professional' | 'control' | 'ai_personal'
export type BankQuestionStatus = 'draft' | 'published' | 'archived'
export type InterviewStage = 'screening' | 'recruiter' | 'hiring_manager' | 'final' | 'expert' | 'full_cycle'
export type QuestionComplexity = 'low' | 'medium' | 'high'
/** Алиас для совместимости (labels-словарь). */
export type Complexity = QuestionComplexity

export interface BankQuestionProbe {
  id: string
  careElement: 'context' | 'action' | 'result' | 'evaluate'
  text: string
  sufficientSignal: string | null
  displayOrder: number
}

export interface BankQuestion {
  id: string
  organizationId: string
  code: string | null
  primaryTopicId: string
  type: BankQuestionType
  text: string
  goal: string | null
  assesses: string | null
  recommendedStage: InterviewStage | null
  expectedSignal: string | null
  strongIndicators: string[]
  weakIndicators: string[]
  durationMin: number | null
  complexity: QuestionComplexity | null
  secondaryTopicIds: string[]
  scaleIdOverride: string | null
  targetRoles: string[]
  tags: string[]
  status: BankQuestionStatus
  version: number
  source: 'manual' | 'ai_generated' | 'imported' | 'from_vacancy'
  careReady: boolean
  careBreakdown?: unknown
  structuredWithVersion?: number | null
  createdAt: string
  updatedAt: string
  probes?: BankQuestionProbe[]
  primaryTopic?: { id: string, name: string, type: string }
}

export interface QualityIssue { code: string, message: string }

export interface BankQuestionFilters {
  topicId?: string
  type?: BankQuestionType | ''
  status?: BankQuestionStatus | ''
  stage?: InterviewStage | ''
  careReady?: boolean
  search?: string
  limit?: number
  offset?: number
}

/** Композабл банка вопросов (org, Спринт 1). */
export function useBankQuestions(filters?: MaybeRefOrGetter<BankQuestionFilters>) {
  const toast = useToast()

  const query = computed(() => {
    const f = toValue(filters) ?? {}
    const params = new URLSearchParams()
    if (f.topicId) params.set('topicId', f.topicId)
    if (f.type) params.set('type', f.type)
    if (f.status) params.set('status', f.status)
    if (f.stage) params.set('stage', f.stage)
    if (f.careReady) params.set('careReady', 'true')
    if (f.search) params.set('search', f.search)
    params.set('limit', String(f.limit ?? 50))
    params.set('offset', String(f.offset ?? 0))
    return params.toString()
  })

  const { data, status, error, refresh } = useFetch<{ items: BankQuestion[], limit: number, offset: number }>(
    () => `/api/question-bank/questions?${query.value}`,
    {
      key: computed(() => `bank-questions-${query.value}`),
      headers: useRequestHeaders(['cookie']),
      default: () => ({ items: [], limit: 50, offset: 0 }),
    },
  )

  const questions = computed(() => data.value?.items ?? [])
  const isLoading = computed(() => status.value === 'pending')

  async function createQuestion(input: Partial<BankQuestion> & { primaryTopicId: string, text: string }) {
    try {
      const created = await $fetch<BankQuestion>('/api/question-bank/questions', { method: 'POST', body: input })
      toast.success('Вопрос создан')
      await refresh()
      return created
    }
    catch (e) {
      toast.error(extractError(e, 'Не удалось создать вопрос'))
      throw e
    }
  }

  async function updateQuestion(id: string, patch: Partial<BankQuestion>) {
    try {
      const updated = await $fetch<BankQuestion>(`/api/question-bank/questions/${id}`, { method: 'PATCH', body: patch })
      toast.success('Сохранено')
      await refresh()
      return updated
    }
    catch (e) {
      toast.error(extractError(e, 'Не удалось сохранить'))
      throw e
    }
  }

  /** Публикация. При 422 возвращает {ok:false, blocking, warnings}. */
  async function publishQuestion(id: string): Promise<{ ok: true, question: BankQuestion } | { ok: false, blocking: QualityIssue[], warnings: QualityIssue[] }> {
    try {
      const question = await $fetch<BankQuestion>(`/api/question-bank/questions/${id}/publish`, { method: 'POST' })
      toast.success('Вопрос опубликован')
      await refresh()
      return { ok: true, question }
    }
    catch (e: unknown) {
      const data = (e as { data?: { data?: { blocking?: QualityIssue[], warnings?: QualityIssue[] } } })?.data?.data
      if (data?.blocking) {
        toast.error('Вопрос не прошёл проверку качества')
        return { ok: false, blocking: data.blocking ?? [], warnings: data.warnings ?? [] }
      }
      toast.error(extractError(e, 'Не удалось опубликовать'))
      throw e
    }
  }

  async function archiveQuestion(id: string) {
    try {
      await $fetch(`/api/question-bank/questions/${id}/archive`, { method: 'POST' })
      toast.success('Вопрос архивирован')
      await refresh()
    }
    catch (e) {
      toast.error(extractError(e, 'Не удалось архивировать'))
      throw e
    }
  }

  async function generateQuestions(topicId: string, count: number, extraInstruction?: string) {
    try {
      const res = await $fetch<{ created: BankQuestion[], skipped: number }>('/api/question-bank/questions/generate', {
        method: 'POST',
        body: { topicId, count, extraInstruction: extraInstruction ?? '' },
      })
      toast.success(`Сгенерировано: ${res.created.length}${res.skipped ? `, пропущено дублей: ${res.skipped}` : ''}`)
      await refresh()
      return res
    }
    catch (e) {
      toast.error(extractError(e, 'Не удалось сгенерировать вопросы'))
      throw e
    }
  }

  return {
    questions, isLoading, error, refresh,
    createQuestion, updateQuestion, publishQuestion, archiveQuestion, generateQuestions,
  }
}

/** Извлечь сообщение об ошибке из h3/ofetch. */
export function extractError(e: unknown, fallback: string): string {
  const msg = (e as { data?: { statusMessage?: string, message?: string }, statusMessage?: string })
  return msg?.data?.statusMessage || msg?.data?.message || msg?.statusMessage || fallback
}
