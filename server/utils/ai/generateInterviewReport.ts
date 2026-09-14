/**
 * Генерация отчёта по интервью нашим ассистентом (Спринт 5, поток Б).
 * Вход: транскрипт MyMeet + персональный опросник + BARS-якоря тем + шаблон отчёта.
 * Устойчивая Zod-схема + token-budget обрезка транскрипта + детерминированная сборка.
 * docs/tz-questions-05-mymeet-reports.md §5.8
 */
import { z } from 'zod'
import { generateStructuredOutput, type ProviderConfig } from './provider'
import { normalizeQuestion } from '../text/normalizeQuestion'

const confidence = z.enum(['low', 'medium', 'high'])

const questionAnswerSchema = z.object({
  itemId: z.string().catch('').default(''),
  questionText: z.string().catch('').default(''),
  topicId: z.string().nullable().catch(null).default(null),
  matched: z.boolean().catch(false).default(false),
  answerText: z.string().catch('').default(''),
  evidence: z.array(z.string()).catch([]).default([]),
  barsValue: z.string().nullable().catch(null).default(null),
  barsRationale: z.string().catch('').default(''),
  confidence: confidence.catch('low').default('low'),
})

const sectionSchema = z.object({
  topicId: z.string().nullable().catch(null).default(null),
  title: z.string().catch('').default(''),
  summary: z.string().catch('').default(''),
  barsValue: z.string().nullable().catch(null).default(null),
})

const riskVerifiedSchema = z.object({
  issue: z.string().catch('').default(''),
  verdict: z.enum(['confirmed', 'refuted', 'insufficient_data']).catch('insufficient_data').default('insufficient_data'),
  evidence: z.array(z.string()).catch([]).default([]),
})

export const interviewReportSchema = z.object({
  summary: z.string().catch('').default(''),
  overallImpression: z.string().catch('').default(''),
  sections: z.array(sectionSchema).catch([]).default([]),
  questionAnswers: z.array(questionAnswerSchema).catch([]).default([]),
  risksVerified: z.array(riskVerifiedSchema).catch([]).default([]),
  recommendedNextSteps: z.array(z.string()).catch([]).default([]),
})

export type InterviewReport = z.infer<typeof interviewReportSchema>
export type QuestionAnswerMatch = z.infer<typeof questionAnswerSchema>

export interface ReportQuestionInput {
  itemId: string
  text: string
  listenFor: string | null
  topicId: string | null
}
export interface ReportBarsInput {
  topicId: string
  topicName: string
  scaleType: string
  anchors: { value: string, anchorText: string }[]
}
export interface GenerateReportInput {
  transcript: string
  questions: ReportQuestionInput[]
  bars: ReportBarsInput[]
  reportTemplatePromptText: string
  jobContext?: { title?: string, briefHighlights?: string }
  riskSummary?: string
  /** Лимит символов транскрипта (token-budget, §5.8.3a). */
  transcriptCharBudget?: number
}

export const DEFAULT_REPORT_PROMPT = `Ты — старший HR-эксперт. Составь объективный отчёт по HR-интервью на основе ТРАНСКРИПТА встречи, ПЕРСОНАЛЬНОГО ОПРОСНИКА (повестки) и BARS-ЯКОРЕЙ тем оценки.

ЖЕЛЕЗНЫЕ ПРАВИЛА:
1. Интерпретируй ответы кандидата СТРОГО по поведенческим якорям (BARS) тем — это каркас интерпретации, не личная шкала.
2. НЕ ВЫДУМЫВАЙ. Любой вывод подкрепляй ДОСЛОВНОЙ цитатой из транскрипта (evidence). Нет цитаты — нет вывода.
3. «НЕДОСТАТОЧНО ДАННЫХ» предпочтительнее догадки: тема не раскрыта → matched=false, barsValue=null.
4. HUMAN-IN-THE-LOOP: не принимай решение о найме, не выставляй вердикт «брать/не брать». Готовь материал для рекрутёра.
5. Не оценивай по защищённым признакам (возраст, пол, национальность, семья и т.п.).
6. Веди разбор ПО ТЕМАМ опросника (CARE: Context/Action/Result/Evaluate). Для каждого вопроса найди ответ, оцени по якорям, приведи evidence.
7. Проверь риски до интервью (если переданы): confirmed/refuted/insufficient_data с цитатами.

ФОРМАТ: строго JSON (summary, overallImpression, sections[], questionAnswers[], risksVerified[], recommendedNextSteps[]). summary — сжатый фактический вывод БЕЗ решения о найме.`

/**
 * Token-budget обрезка транскрипта (§5.8.3a): если превышает бюджет — отбираем
 * сегменты, лексически близкие к вопросам опросника (без LLM).
 */
export function trimTranscript(transcript: string, questions: ReportQuestionInput[], charBudget: number): { text: string, truncated: boolean } {
  if (transcript.length <= charBudget) return { text: transcript, truncated: false }
  // Сегментация по строкам (реплики). Ранжируем по пересечению токенов с вопросами.
  const qTokens = new Set(
    questions.flatMap(q => normalizeQuestion(`${q.text} ${q.listenFor ?? ''}`).split(' ')).filter(t => t.length > 3),
  )
  const segments = transcript.split(/\n+/).filter(Boolean)
  const scored = segments.map((seg, i) => {
    const segTokens = normalizeQuestion(seg).split(' ')
    const score = segTokens.reduce((n, t) => n + (qTokens.has(t) ? 1 : 0), 0)
    return { seg, i, score }
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  const picked: { seg: string, i: number }[] = []
  let len = 0
  for (const s of scored) {
    if (len + s.seg.length > charBudget) continue
    picked.push({ seg: s.seg, i: s.i })
    len += s.seg.length + 1
  }
  // Восстановим хронологический порядок отобранных.
  picked.sort((a, b) => a.i - b.i)
  return { text: picked.map(p => p.seg).join('\n'), truncated: true }
}

function buildDataBlocks(input: GenerateReportInput, transcript: string, truncated: boolean): string {
  const questionsJson = input.questions.map(q => ({ itemId: q.itemId, text: q.text, listenFor: q.listenFor, topicId: q.topicId }))
  const barsJson = input.bars.map(b => ({
    topicId: b.topicId, topic: b.topicName, scaleType: b.scaleType,
    anchors: b.anchors,
  }))
  const parts: string[] = []
  if (input.jobContext?.title || input.jobContext?.briefHighlights) {
    parts.push(`<вакансия>\n${input.jobContext.title ?? ''}\n${input.jobContext.briefHighlights ?? ''}\n</вакансия>`)
  }
  parts.push(`<опросник>\n${JSON.stringify(questionsJson, null, 0)}\n</опросник>`)
  parts.push(`<bars-якоря>\n${JSON.stringify(barsJson, null, 0)}\n</bars-якоря>`)
  if (input.riskSummary) parts.push(`<риски-до-интервью>\n${input.riskSummary}\n</риски-до-интервью>`)
  parts.push(`<транскрипт${truncated ? ' усечён="по бюджету"' : ''}>\n${transcript}\n</транскрипт>`)
  return parts.join('\n\n')
}

export async function generateInterviewReport(
  config: ProviderConfig,
  input: GenerateReportInput,
): Promise<{ report: InterviewReport, truncated: boolean }> {
  const budget = input.transcriptCharBudget ?? 40_000
  const { text: transcript, truncated } = trimTranscript(input.transcript, input.questions, budget)

  const system = input.reportTemplatePromptText?.trim() ? input.reportTemplatePromptText : DEFAULT_REPORT_PROMPT

  const result = await generateStructuredOutput(config, {
    system,
    prompt: buildDataBlocks(input, transcript, truncated),
    schema: interviewReportSchema,
    schemaName: 'InterviewReport',
    schemaDescription: 'Отчёт по HR-интервью на основе транскрипта, опросника и BARS',
    wrapBareArray: items => ({ sections: items }),
    temperature: 0.1,
  })

  // Сверка itemId с реальными вопросами; неизвестные — отбрасываем.
  const validIds = new Set(input.questions.map(q => q.itemId))
  const report = result.object
  report.questionAnswers = report.questionAnswers.filter(qa => !qa.itemId || validIds.has(qa.itemId))

  return { report, truncated }
}

/** Детерминированная сборка markdown-отчёта (тестируемый рендер). */
export function renderReportMarkdown(report: InterviewReport): string {
  const lines: string[] = []
  lines.push('# Отчёт по интервью', '')
  if (report.summary) lines.push('## Резюме', report.summary, '')
  if (report.overallImpression) lines.push('## Общее впечатление', report.overallImpression, '')
  if (report.sections.length) {
    lines.push('## По темам')
    for (const s of report.sections) {
      lines.push(`### ${s.title || s.topicId || 'Тема'}${s.barsValue ? ` (оценка: ${s.barsValue})` : ''}`)
      if (s.summary) lines.push(s.summary)
      lines.push('')
    }
  }
  if (report.questionAnswers.length) {
    lines.push('## Ответы по вопросам')
    for (const qa of report.questionAnswers) {
      lines.push(`- **${qa.questionText}** — ${qa.matched ? qa.answerText : 'недостаточно данных'}${qa.barsValue ? ` [${qa.barsValue}]` : ''}`)
      for (const ev of qa.evidence) lines.push(`  > ${ev}`)
    }
    lines.push('')
  }
  if (report.risksVerified.length) {
    lines.push('## Проверка рисков')
    for (const r of report.risksVerified) lines.push(`- ${r.issue}: **${r.verdict}**`)
    lines.push('')
  }
  if (report.recommendedNextSteps.length) {
    lines.push('## Рекомендованные шаги')
    for (const s of report.recommendedNextSteps) lines.push(`- ${s}`)
  }
  return lines.join('\n')
}
