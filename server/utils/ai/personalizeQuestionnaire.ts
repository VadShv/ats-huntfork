/**
 * LLM-персонализация опросника под кандидата (Спринт 4). Опциональный проход
 * поверх детерминированного каркаса. Устойчивая Zod-схема + graceful degradation.
 * docs/tz-questions-04-candidate-questionnaire.md §6
 */
import { z } from 'zod'
import { generateStructuredOutput, type ProviderConfig } from './provider'
import { withAiOperation } from './usage/context'

const careElements = ['context', 'action', 'result', 'evaluate'] as const

const personalizedItemSchema = z.object({
  index: z.number().catch(-1).default(-1), // индекс исходного вопроса каркаса
  text: z.string().catch('').default(''), // персонализированная формулировка
  careProbes: z.array(z.object({
    careElement: z.enum(careElements).catch('context').default('context'),
    text: z.string().catch('').default(''),
    sufficientSignal: z.string().catch('').default(''),
  })).catch([]).default([]),
  expectedEvidence: z.array(z.string()).catch([]).default([]),
  greenFlags: z.array(z.string()).catch([]).default([]),
  redFlags: z.array(z.string()).catch([]).default([]),
})

const resultSchema = z.object({
  items: z.array(personalizedItemSchema).catch([]).default([]),
})

export interface ScaffoldItem {
  text: string
  origin: string
  listenFor: string | null
  isRisk: boolean
}

export interface PersonalizedItem {
  index: number
  text: string
  careProbes: { careElement: typeof careElements[number], text: string, sufficientSignal: string }[]
  expectedEvidence: string[]
  greenFlags: string[]
  redFlags: string[]
}

export interface PersonalizeInput {
  candidateContext: { resumeText?: string, keyFacts?: string[], strengths?: string[], riskSummary?: string }
  scaffold: ScaffoldItem[]
  careInstruction?: string
  carePromptText?: string
  jobContext?: { title?: string, briefHighlights?: string }
}

export const DEFAULT_PERSONALIZE_PROMPT = `РОЛЬ: Ты — методолог структурированных интервью. Ты адаптируешь общие вопросы опросника под опыт конкретного кандидата, следуя методике CARE (от общего к частному), не искажая смысл.

ЗАДАЧА:
1. Для каждого вопроса каркаса дай персонализированную формулировку под опыт кандидата (text), сохранив исходный смысл.
2. Добавь 2–4 probe-уточнения по CARE (context/action/result/evaluate), ведущих от общего к частному.
3. Укажи ожидаемые свидетельства (expectedEvidence), зелёные (greenFlags) и красные (redFlags) флаги.
4. Верни привязку по индексу исходного вопроса (index).

ОГРАНИЧЕНИЯ:
— Вопросы с пометкой RISK (верификационные) НЕ искажать: сохранить смысл и listenFor, добавить только probe и лёгкую адаптацию.
— Не выдумывать факты вне резюме; «недостаточно данных» предпочтительнее догадки.
— Не использовать чувствительные признаки (возраст, пол, национальность, религия, семейное положение, здоровье).

ФОРМАТ: строго JSON по схеме { items: [...] }. Без markdown.`

function buildUserPrompt(input: PersonalizeInput): string {
  const c = input.candidateContext
  const parts: string[] = []
  if (input.jobContext?.title) parts.push(`Вакансия: ${input.jobContext.title}`)
  if (input.jobContext?.briefHighlights) parts.push(`Бриф: ${input.jobContext.briefHighlights}`)
  if (c.keyFacts?.length) parts.push(`Ключевые факты кандидата: ${c.keyFacts.join('; ')}`)
  if (c.strengths?.length) parts.push(`Сильные стороны: ${c.strengths.join('; ')}`)
  if (c.riskSummary) parts.push(`Риски: ${c.riskSummary}`)
  if (c.resumeText) parts.push(`Резюме (фрагмент): ${c.resumeText.slice(0, 4000)}`)
  const scaffold = input.scaffold
    .map((s, i) => `${i}. ${s.isRisk ? '[RISK] ' : ''}${s.text}${s.listenFor ? ` (слушать: ${s.listenFor})` : ''}`)
    .join('\n')
  parts.push(`\nВопросы каркаса (по индексам):\n${scaffold}`)
  return parts.join('\n')
}

/**
 * Персонализация. Возвращает массив по индексам каркаса.
 * Бросает при ошибке LLM — вызывающий код деградирует до каркаса.
 */
export async function personalizeQuestionnaire(
  config: ProviderConfig,
  input: PersonalizeInput,
): Promise<PersonalizedItem[]> {
  const system = input.carePromptText?.trim()
    ? input.carePromptText
    : `${DEFAULT_PERSONALIZE_PROMPT}${input.careInstruction ? `\n\nМЕТОДИКА CARE:\n${input.careInstruction}` : ''}`

  const result = await withAiOperation({ operation: 'interview.personalizeQuestionnaire' }, () => generateStructuredOutput(config, {
    system,
    prompt: buildUserPrompt(input),
    schema: resultSchema,
    schemaName: 'personalized_questionnaire',
    schemaDescription: 'Персонализированные вопросы опросника под кандидата',
    wrapBareArray: items => ({ items }),
    temperature: 0.3,
  }))

  return result.object.items
    .filter(it => it.index >= 0 && it.index < input.scaffold.length)
    .map(it => ({
      index: it.index,
      text: it.text.trim(),
      careProbes: it.careProbes.map(p => ({ careElement: p.careElement, text: p.text.trim(), sufficientSignal: p.sufficientSignal.trim() })).filter(p => p.text),
      expectedEvidence: it.expectedEvidence.map(s => s.trim()).filter(Boolean).slice(0, 5),
      greenFlags: it.greenFlags.map(s => s.trim()).filter(Boolean).slice(0, 5),
      redFlags: it.redFlags.map(s => s.trim()).filter(Boolean).slice(0, 5),
    }))
}
