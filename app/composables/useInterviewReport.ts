import type { MaybeRefOrGetter } from 'vue'
import { extractError } from './useBankQuestions'

export interface QuestionAnswerMatch {
  itemId: string
  questionText: string
  topicId: string | null
  matched: boolean
  answerText: string
  evidence: string[]
  barsValue: string | null
  barsRationale: string
  confidence: 'low' | 'medium' | 'high'
}

export interface InterviewReportRow {
  id: string
  status: 'importing' | 'generating' | 'completed' | 'failed'
  source: 'mymeet' | 'assistant'
  summary: string | null
  reportMarkdown: string | null
  questionAnswerMap: QuestionAnswerMatch[] | null
  templateName: string | null
  generatedByModel: string | null
  errorMessage: string | null
  externalMeetingId: string
}

export function useInterviewReport(applicationId: MaybeRefOrGetter<string>) {
  const toast = useToast()
  const id = computed(() => toValue(applicationId))

  const { data, status, refresh } = useFetch<{ report: InterviewReportRow | null }>(
    () => `/api/applications/${id.value}/interview-report`,
    { key: computed(() => `interview-report-${id.value}`), headers: useRequestHeaders(['cookie']), default: () => ({ report: null }) },
  )

  const report = computed(() => data.value?.report ?? null)
  const isProcessing = computed(() => report.value?.status === 'importing' || report.value?.status === 'generating')

  async function generate(source: 'mymeet' | 'assistant', externalMeetingId: string, reportTemplateId?: string | null) {
    try {
      const res = await $fetch<{ meetingReportId: string, status: string }>(
        `/api/applications/${id.value}/interview-report/generate`,
        { method: 'POST', body: { source, externalMeetingId, reportTemplateId, writeBackAnswers: true } },
      )
      toast.success(source === 'assistant' ? 'Генерация отчёта запущена' : 'Импорт отчёта запущен')
      await refresh()
      return res
    }
    catch (e) { toast.error(extractError(e, 'Не удалось запустить отчёт')); throw e }
  }

  return { report, isProcessing, status, refresh, generate }
}
