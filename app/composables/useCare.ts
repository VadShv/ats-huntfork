import { extractError } from './useBankQuestions'

export type CarePromptKind = 'structure_question' | 'personalize_questionnaire' | 'generate_report'
export type CareElement = 'context' | 'action' | 'result' | 'evaluate'

export interface CareMethodology {
  id: string
  version: number
  isActive: boolean
  title: string
  description: string | null
  interviewerInstruction: string | null
  sufficiencyCriteria: Record<string, { sufficientSignal: string, evasionSignal: string, minEvidence?: number }>
  probeRules: { trigger: string, recommendedProbe: string, careElement?: string }[]
  probeLimitPerElement: number
  probeLimitPerQuestion: number
  changeNote: string | null
  publishedAt: string | null
}

export interface CarePrompt {
  id: string
  kind: CarePromptKind
  promptText: string
  variables: { name: string, description: string, required: boolean, example?: string }[]
  version: number
  isActive: boolean
  methodologyVersion: number
}

export interface CareProbeTrigger {
  id: string
  trigger: string
  recommendedProbe: string
  careElement: CareElement | null
  isBuiltin: boolean
  isActive: boolean
  displayOrder: number
}

export function useCare() {
  const toast = useToast()

  const { data: methodology, refresh: refreshMethodology } = useFetch<CareMethodology>(
    '/api/question-bank/care/methodology',
    { key: 'care-methodology', headers: useRequestHeaders(['cookie']) },
  )

  const { data: promptsData, refresh: refreshPrompts } = useFetch<{ items: CarePrompt[] }>(
    '/api/question-bank/care/prompts',
    { key: 'care-prompts', headers: useRequestHeaders(['cookie']), default: () => ({ items: [] }) },
  )

  const { data: triggersData, refresh: refreshTriggers } = useFetch<{ items: CareProbeTrigger[] }>(
    '/api/question-bank/care/triggers',
    { key: 'care-triggers', headers: useRequestHeaders(['cookie']), default: () => ({ items: [] }) },
  )

  const prompts = computed(() => promptsData.value?.items ?? [])
  const triggers = computed(() => triggersData.value?.items ?? [])

  async function saveMethodology(patch: Partial<CareMethodology>) {
    try {
      await $fetch('/api/question-bank/care/methodology', { method: 'PUT', body: patch })
      toast.success('Методика сохранена (новая версия)')
      await refreshMethodology()
    }
    catch (e) { toast.error(extractError(e, 'Не удалось сохранить методику')); throw e }
  }

  async function savePrompt(kind: CarePromptKind, promptText: string, variables: CarePrompt['variables'], changeNote?: string) {
    try {
      await $fetch(`/api/question-bank/care/prompts/${kind}`, { method: 'PUT', body: { promptText, variables, changeNote } })
      toast.success('Промпт сохранён (новая версия)')
      await refreshPrompts()
    }
    catch (e) { toast.error(extractError(e, 'Не удалось сохранить промпт')); throw e }
  }

  async function saveTriggers(list: Partial<CareProbeTrigger>[]) {
    try {
      await $fetch('/api/question-bank/care/triggers', { method: 'PUT', body: { triggers: list } })
      toast.success('Триггеры сохранены')
      await refreshTriggers()
    }
    catch (e) { toast.error(extractError(e, 'Не удалось сохранить триггеры')); throw e }
  }

  /** Разложить вопрос банка по CARE. Возвращает breakdown или partial. */
  async function structureCare(questionId: string) {
    try {
      const res = await $fetch<{ partial: boolean, breakdown?: unknown, message?: string }>(
        `/api/question-bank/questions/${questionId}/structure-care`,
        { method: 'POST', body: {} },
      )
      if (res.partial) toast.warning(res.message ?? 'Разложение выполнено частично')
      else toast.success('Вопрос разложен по CARE')
      return res
    }
    catch (e) { toast.error(extractError(e, 'Не удалось разложить по CARE')); throw e }
  }

  return {
    methodology, prompts, triggers,
    refreshMethodology, refreshPrompts, refreshTriggers,
    saveMethodology, savePrompt, saveTriggers, structureCare,
  }
}
