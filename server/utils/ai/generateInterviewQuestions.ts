/**
 * Генерация банка интервью-вопросов под вакансию (Этап 2).
 *
 * На вход: описание вакансии + (опц.) бриф + инструкция рекрутера. На выход —
 * список вопросов с категорией, обоснованием и признаками сильного ответа.
 * Используется 'analysis'-провайдер организации (тот же, что для скоринга/саммари).
 *
 * Схема устойчива к слабым провайдерам (.catch().default() + wrapBareArray),
 * как в generateCriteriaFromDescription.
 */
import { z } from 'zod'
import { generateStructuredOutput, type ProviderConfig } from './provider'

export const interviewQuestionCategories = [
  'hard_skill', 'soft_skill', 'experience', 'motivation', 'culture', 'logistics', 'risk_probe', 'other',
] as const
export type InterviewQuestionCategory = (typeof interviewQuestionCategories)[number]

const generatedQuestionsSchema = z.object({
  questions: z.array(z.object({
    text: z.string(),
    category: z.enum(interviewQuestionCategories).catch('other').default('other'),
    rationale: z.string().catch('').default(''),
    goodAnswer: z.string().catch('').default(''),
  })),
})

export interface GeneratedInterviewQuestion {
  text: string
  category: InterviewQuestionCategory
  rationale: string
  goodAnswer: string
}

export interface BriefContext {
  hardMustHave?: string[]
  niceToHave?: string[]
  dealBreakers?: string[]
  redFlagsToWatch?: string[]
  responsibilities?: string | null
  idealProfile?: string | null
  teamContext?: string | null
  freeform?: string | null
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function buildBriefBlock(brief?: BriefContext | null): string {
  if (!brief) return ''
  const parts: string[] = []
  if (brief.hardMustHave?.length) parts.push(`Жёсткие требования: ${brief.hardMustHave.join(', ')}`)
  if (brief.niceToHave?.length) parts.push(`Желательно: ${brief.niceToHave.join(', ')}`)
  if (brief.dealBreakers?.length) parts.push(`Стоп-факторы: ${brief.dealBreakers.join(', ')}`)
  if (brief.redFlagsToWatch?.length) parts.push(`На что смотреть: ${brief.redFlagsToWatch.join(', ')}`)
  if (brief.responsibilities) parts.push(`Реальные задачи: ${brief.responsibilities}`)
  if (brief.idealProfile) parts.push(`Портрет идеального кандидата: ${brief.idealProfile}`)
  if (brief.teamContext) parts.push(`Команда: ${brief.teamContext}`)
  if (brief.freeform) parts.push(`Заметки: ${brief.freeform}`)
  if (!parts.length) return ''
  return `\n\n<бриф>\n${parts.join('\n')}\n</бриф>`
}

/**
 * Сгенерировать интервью-вопросы из описания вакансии, брифа и инструкции рекрутера.
 * Возвращает нормализованный список (пустые тексты отсеиваются).
 */
export async function generateInterviewQuestions(
  config: ProviderConfig,
  opts: {
    jobTitle: string
    jobDescription: string
    promptText: string
    brief?: BriefContext | null
    count?: number
  },
): Promise<GeneratedInterviewQuestion[]> {
  const count = Math.min(Math.max(opts.count ?? 10, 1), 30)
  const description = stripHtml(opts.jobDescription ?? '').slice(0, 8000)
  const briefBlock = buildBriefBlock(opts.brief)
  const instruction = opts.promptText?.trim()
    ? `\n\n<инструкция-рекрутера>\n${opts.promptText.trim().slice(0, 4000)}\n</инструкция-рекрутера>`
    : ''

  const result = await generateStructuredOutput(config, {
    system: `Ты — опытный рекрутер, который готовит вопросы для интервью с кандидатами.
Твоя задача — сгенерировать примерно ${count} релевантных вопросов СТРОГО по вакансии, брифу и инструкции рекрутера.

Правила:
— Вопросы должны быть конкретными и проверять реальные требования роли.
— Опирайся на бриф (жёсткие требования, стоп-факторы, задачи) если он есть.
— Если есть инструкция рекрутера — следуй ей в приоритете.
— Не выдумывай требований, которых нет в контексте.
— Пиши на русском, ясно и по делу.
— Для каждого вопроса укажи категорию (СТРОГО одно из: hard_skill, soft_skill, experience, motivation, culture, logistics, risk_probe, other), краткое обоснование (rationale — зачем этот вопрос) и признаки сильного ответа (goodAnswer).
— Избегай дискриминационных вопросов (возраст, пол, национальность, семейное положение).`,
    prompt: `Название вакансии: ${opts.jobTitle}\n\n<вакансия>\n${description}\n</вакансия>${briefBlock}${instruction}\n\nСгенерируй вопросы для интервью.`,
    schema: generatedQuestionsSchema,
    schemaName: 'GeneratedInterviewQuestions',
    schemaDescription: 'Интервью-вопросы, сгенерированные под вакансию',
    wrapBareArray: items => ({ questions: items }),
  })

  return result.object.questions
    .map(q => ({
      text: q.text.trim(),
      category: q.category,
      rationale: q.rationale.trim(),
      goodAnswer: q.goodAnswer.trim(),
    }))
    .filter(q => q.text !== '')
}
