import type { MaybeRefOrGetter } from 'vue'
import { extractError } from './useBankQuestions'

export interface CoverageRow {
  criterionId: string
  key: string | null
  name: string | null
  weight: number
  questionCount: number
  covered: boolean
}
export interface CoverageMatrix {
  coverage: CoverageRow[]
  gaps: CoverageRow[]
  uncategorizedQuestions: number
  totalQuestions: number
  hasCriteria: boolean
  updatesAvailable: { questionId: string, sourceBankQuestionId: string, fromVersion: number | null, toVersion: number }[]
}

/** Композабл карты вопросов вакансии: импорт пресета, матрица покрытия, sync. */
export function useJobQuestionnaire(jobId: MaybeRefOrGetter<string>) {
  const toast = useToast()
  const id = computed(() => toValue(jobId))

  const { data: matrix, refresh: refreshMatrix } = useFetch<CoverageMatrix>(
    () => `/api/jobs/${id.value}/interview-questions/coverage-matrix`,
    { key: computed(() => `coverage-${id.value}`), headers: useRequestHeaders(['cookie']) },
  )

  async function importPreset(presetId: string, replace = false) {
    try {
      const res = await $fetch<{ inserted: number, skippedDuplicates: number }>(
        `/api/jobs/${id.value}/interview-questions/import-preset`,
        { method: 'POST', body: { presetId, replace } },
      )
      toast.success(`Импортировано: ${res.inserted}${res.skippedDuplicates ? `, пропущено дублей: ${res.skippedDuplicates}` : ''}`)
      await refreshMatrix()
      return res
    }
    catch (e) { toast.error(extractError(e, 'Не удалось импортировать пресет')); throw e }
  }

  async function addFromBank(bankQuestionIds: string[], criterionId?: string | null) {
    try {
      const res = await $fetch<{ inserted: number, skippedDuplicates: number }>(
        `/api/jobs/${id.value}/interview-questions/add-from-bank`,
        { method: 'POST', body: { bankQuestionIds, criterionId } },
      )
      toast.success(`Добавлено: ${res.inserted}`)
      await refreshMatrix()
      return res
    }
    catch (e) { toast.error(extractError(e, 'Не удалось добавить из банка')); throw e }
  }

  async function linkCriterion(questionId: string, criterionId: string | null) {
    try {
      await $fetch(`/api/jobs/${id.value}/interview-questions/${questionId}/link-criterion`, { method: 'PUT', body: { criterionId } })
      await refreshMatrix()
    }
    catch (e) { toast.error(extractError(e, 'Не удалось привязать критерий')); throw e }
  }

  async function syncUpdates(accept: { questionId: string, fields: string[] }[], keepLocal: { questionId: string }[]) {
    try {
      const res = await $fetch<{ accepted: number, kept: number }>(
        `/api/jobs/${id.value}/interview-questions/sync-updates`,
        { method: 'POST', body: { accept, keepLocal } },
      )
      toast.success(`Синхронизировано: принято ${res.accepted}, оставлено ${res.kept}`)
      await refreshMatrix()
      return res
    }
    catch (e) { toast.error(extractError(e, 'Не удалось синхронизировать')); throw e }
  }

  return { matrix, refreshMatrix, importPreset, addFromBank, linkCriterion, syncUpdates }
}
