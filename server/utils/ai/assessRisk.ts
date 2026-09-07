/**
 * Смысловой риск-движок резюме (Этап 3, LLM-часть).
 *
 * LLM ИНТЕРПРЕТИРУЕТ факты и текст, но НЕ считает даты (частота смен уже
 * посчитана детерминированно в server/utils/risk/timeline.ts и передаётся
 * готовыми числами). Находки содержат confidence (date_math|document|linguistic),
 * доброкачественную альтернативу, готовый вопрос и listenFor — это прямой вход
 * для персональных вопросов (Этап 4).
 *
 * overallRisk агрегируется в КОДЕ (aggregateRisk) с cap: high только при
 * hard-evidence (date_math|document) либо high job-hopping; чистая лингвистика
 * не поднимает выше medium — гасит false-positive шторм.
 */
import { z } from 'zod'
import { generateStructuredOutput, type ProviderConfig } from './provider'
import type { TenureFacts } from '../risk/timeline'

export const riskFindingCategories = ['inconsistency', 'suspicious', 'fact_to_verify'] as const
export const riskConfidences = ['date_math', 'document', 'linguistic'] as const
export const riskSeverities = ['low', 'medium', 'high'] as const

const findingsSchema = z.object({
  findings: z.array(z.object({
    claim: z.string().catch('').default(''),
    issue: z.string().catch('').default(''),
    category: z.enum(riskFindingCategories).catch('fact_to_verify').default('fact_to_verify'),
    confidence: z.enum(riskConfidences).catch('linguistic').default('linguistic'),
    severity: z.enum(riskSeverities).catch('low').default('low'),
    evidence: z.string().catch('').default(''),
    alternative: z.string().catch('').default(''),
    question: z.string().catch('').default(''),
    listenFor: z.string().catch('').default(''),
  })).catch([]).default([]),
  metrics: z.object({
    density: z.number().int().min(0).max(100).catch(0).default(0),
    adequacy: z.number().int().min(0).max(100).catch(0).default(0),
  }).catch({ density: 0, adequacy: 0 }).default({ density: 0, adequacy: 0 }),
  summary: z.string().catch('').default(''),
})

export type RiskFinding = z.infer<typeof findingsSchema>['findings'][number]
export type RiskFindings = z.infer<typeof findingsSchema>

export interface RiskPolicyInput {
  extraInstructions?: string | null
}

/**
 * Запускает LLM-анализ смысловых рисков резюме. Даты НЕ анализирует —
 * получает готовые факты по частоте смен (tenure) для контекста.
 */
export async function assessResumeRisk(
  config: ProviderConfig,
  opts: {
    currentDate: Date
    resumeText: string
    tenure: TenureFacts
    policy?: RiskPolicyInput | null
  },
): Promise<{ object: RiskFindings, usage: { promptTokens: number, completionTokens: number }, responseModel: string | null }> {
  const iso = opts.currentDate.toISOString().slice(0, 10)

  // Готовые факты по датам — для контекста, чтобы LLM не пересчитывал.
  const tenureBlock = opts.tenure.hasStructuredDates
    ? `Мест работы: ${opts.tenure.jobsCount}; средний срок: ${opts.tenure.avgTenureMonths} мес; `
      + `коротких мест (<порога): ${opts.tenure.shortStints.length}; `
      + `частота смен (job-hopping): ${opts.tenure.jobHoppingLevel}.`
    : 'Структурированных дат нет — период работы не анализируй.'

  const extra = opts.policy?.extraInstructions?.trim()
    ? `\n\nДополнительные указания организации:\n${opts.policy.extraInstructions.trim().slice(0, 2000)}`
    : ''

  const system
    = `Ты — аналитик отбора в ATS. Сегодня ${iso}. `
      + 'Работай ТОЛЬКО с фактами из резюме и с переданными числами по датам. '
      + 'КРИТИЧЕСКИ ВАЖНО: НЕ считай даты, стаж, длительность и разрывы — они уже посчитаны отдельным модулем. '
      + 'Оценивай только САМО РЕЗЮМЕ: смысловые противоречия, подозрительные утверждения и факты, требующие проверки (фактчекинг). '
      + 'НЕ оценивай соответствие какой-либо вакансии (это отдельный контур). '
      + 'Для каждой находки укажи: '
      + 'category (inconsistency — внутреннее противоречие; suspicious — подозрительно; fact_to_verify — требует проверки), '
      + 'confidence (date_math — вывод из переданных чисел по датам; document — прямой факт из текста; linguistic — из формулировок/тона), '
      + 'severity (low|medium|high), evidence (цитата-основание из текста), '
      + 'alternative (доброкачественное объяснение находки), '
      + 'question (готовый вопрос для интервью) и listenFor (на что смотреть в ответе). '
      + 'Не выдумывай фактов. Не принимай решение о найме. Если данных мало — верни короткий список, не заполняй догадками. '
      + 'Пиши на русском, кратко и по делу.'
      + extra

  const prompt
    = `<сегодня>${iso}</сегодня>\n\n`
      + `<факты-по-датам>\n${tenureBlock}\n</факты-по-датам>\n\n`
      + `<резюме>\n${opts.resumeText.slice(0, 16_000)}\n</резюме>\n\n`
      + 'Проведи смысловой риск-анализ резюме по правилам выше.'

  return generateStructuredOutput(config, {
    system,
    prompt,
    schema: findingsSchema,
    schemaName: 'resume_risk_findings',
    schemaDescription: 'Смысловые риск-находки по резюме кандидата',
    temperature: 0,
    wrapBareArray: (items) => ({ findings: items, metrics: { density: 0, adequacy: 0 }, summary: '' }),
  })
}

// ─── Детерминированная агрегация overallRisk с cap ────────────────

const SEVERITY_WEIGHT: Record<(typeof riskSeverities)[number], number> = { low: 1, medium: 3, high: 6 }
const HARD_CONFIDENCE = new Set(['date_math', 'document'])

export interface AggregateResult {
  overallRisk: 'low' | 'medium' | 'high'
  overallScore: number
  isCapped: boolean
}

/**
 * Комбинирует смысловые находки и частоту смен в overallRisk с cap.
 *
 * Cap: если capLinguisticToMedium и НЕТ ни одной находки с hard-evidence
 * (date_math|document) И job-hopping не high — потолок «medium», даже если
 * лингвистики набралось на high. Гасит false-positive шторм.
 */
export function aggregateRisk(
  findings: Array<Pick<RiskFinding, 'severity' | 'confidence'>>,
  tenure: Pick<TenureFacts, 'jobHoppingLevel' | 'jobHoppingScore'>,
  opts: { capLinguisticToMedium: boolean } = { capLinguisticToMedium: true },
): AggregateResult {
  // Сырой скор находок (0..100, насыщение).
  const rawFindings = findings.reduce((s, f) => s + (SEVERITY_WEIGHT[f.severity] ?? 1), 0)
  const findingsScore = Math.min(100, rawFindings * 10)

  // Вклад частоты смен (job-hopping) в общий скор.
  const tenureScore = tenure.jobHoppingScore ?? 0

  const overallScore = Math.min(100, Math.max(findingsScore, tenureScore))

  const hasHardEvidence = findings.some(f => HARD_CONFIDENCE.has(f.confidence))
  const tenureHigh = tenure.jobHoppingLevel === 'high'

  // Базовый уровень по скору.
  let level: AggregateResult['overallRisk']
    = overallScore >= 65 ? 'high' : overallScore >= 40 ? 'medium' : 'low'

  // Cap: high требует hard-evidence ИЛИ high job-hopping.
  let isCapped = false
  if (level === 'high' && opts.capLinguisticToMedium && !hasHardEvidence && !tenureHigh) {
    level = 'medium'
    isCapped = true
  }

  return { overallRisk: level, overallScore, isCapped }
}
