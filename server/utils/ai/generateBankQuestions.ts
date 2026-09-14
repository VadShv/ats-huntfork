/**
 * AI-генерация вопросов банка под тему оценки (Спринт 1).
 * По образцу generateInterviewQuestions.ts: устойчивая схема (.catch().default()
 * + wrapBareArray), 'analysis'-провайдер организации.
 * docs/tz-questions-01-org-bank.md §1.5
 */
import { z } from 'zod'
import { generateStructuredOutput, type ProviderConfig } from './provider'

const bankQuestionTypes = [
  'behavioral', 'situational', 'motivational', 'factual', 'verification',
  'reflective', 'professional', 'control', 'ai_personal',
] as const
export type GeneratedBankQuestionType = (typeof bankQuestionTypes)[number]

const generatedSchema = z.object({
  questions: z.array(z.object({
    text: z.string(),
    type: z.enum(bankQuestionTypes).catch('behavioral').default('behavioral'),
    goal: z.string().catch('').default(''),
    assesses: z.string().catch('').default(''),
    expectedSignal: z.string().catch('').default(''),
  })),
})

export interface GeneratedBankQuestion {
  text: string
  type: GeneratedBankQuestionType
  goal: string
  assesses: string
  expectedSignal: string
}

export interface TopicContext {
  name: string
  type?: string | null
  definition?: string | null
  goal?: string | null
  positiveIndicators?: string[]
  negativeIndicators?: string[]
}

function buildTopicBlock(topic: TopicContext): string {
  const parts: string[] = [`Название темы: ${topic.name}`]
  if (topic.definition) parts.push(`Определение: ${topic.definition}`)
  if (topic.goal) parts.push(`Что выясняем: ${topic.goal}`)
  if (topic.positiveIndicators?.length) parts.push(`Позитивные индикаторы: ${topic.positiveIndicators.join('; ')}`)
  if (topic.negativeIndicators?.length) parts.push(`Негативные индикаторы: ${topic.negativeIndicators.join('; ')}`)
  return parts.join('\n')
}

export async function generateBankQuestions(
  config: ProviderConfig,
  opts: {
    topic: TopicContext
    count?: number
    extraInstruction?: string
  },
): Promise<GeneratedBankQuestion[]> {
  const count = Math.min(Math.max(opts.count ?? 10, 1), 30)
  const instruction = opts.extraInstruction?.trim()
    ? `\n\n<инструкция>\n${opts.extraInstruction.trim().slice(0, 2000)}\n</инструкция>`
    : ''

  const result = await generateStructuredOutput(config, {
    system: `Ты — методолог структурированных интервью по компетенциям.
Сгенерируй примерно ${count} открытых поведенческих вопросов для оценки заданной темы.

Правила:
— Вопросы ОТКРЫТЫЕ (не да/нет), проверяют реальный прошлый опыт кандидата.
— Один вопрос — одна гипотеза (без двойных вопросов).
— Не выдумывай требований вне темы. Не используй наводящих подсказок правильного ответа.
— Избегай чувствительных признаков (возраст, пол, национальность, семейное положение, здоровье, религия).
— Для каждого вопроса укажи type (СТРОГО одно из: behavioral, situational, motivational, factual, verification, reflective, professional, control, ai_personal), цель (goal), что проверяем (assesses) и признак сильного ответа (expectedSignal).
— Пиши на русском, ясно и по делу.`,
    prompt: `<тема>\n${buildTopicBlock(opts.topic)}\n</тема>${instruction}\n\nСгенерируй вопросы банка для этой темы.`,
    schema: generatedSchema,
    schemaName: 'GeneratedBankQuestions',
    schemaDescription: 'Вопросы банка, сгенерированные под тему оценки',
    wrapBareArray: items => ({ questions: items }),
  })

  return result.object.questions
    .map(q => ({
      text: q.text.trim(),
      type: q.type,
      goal: q.goal.trim(),
      assesses: q.assesses.trim(),
      expectedSignal: q.expectedSignal.trim(),
    }))
    .filter(q => q.text !== '')
}
