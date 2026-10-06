/**
 * AI-структурирование вопроса банка по методике CARE (Спринт 2).
 * По образцу generateBankQuestions/generateInterviewQuestions: устойчивая Zod-схема
 * (.catch().default() + wrapBareArray), детерминированная пост-обработка.
 * docs/tz-questions-02-care.md §5
 */
import { z } from 'zod'
import { generateStructuredOutput, type ProviderConfig } from './provider'
import { withAiOperation } from './usage/context'

const CARE_ORDER = ['context', 'action', 'result', 'evaluate'] as const
export type CareElement = (typeof CARE_ORDER)[number]

const careElementBlock = z.object({
  element: z.enum(CARE_ORDER).catch('context').default('context'),
  probes: z.array(z.string()).catch([]).default([]),
  sufficientSignal: z.string().catch('').default(''),
  evasionSignal: z.string().catch('').default(''),
})

const questionCareV1Schema = z.object({
  isOpenSingle: z.boolean().catch(true).default(true),
  revisedQuestion: z.string().catch('').default(''),
  elements: z.array(careElementBlock).catch([]).default([]),
  expectedEvidence: z.array(z.string()).catch([]).default([]),
  greenFlags: z.array(z.string()).catch([]).default([]),
  redFlags: z.array(z.string()).catch([]).default([]),
  scaleAnchors: z.array(z.object({
    value: z.string().catch('').default(''),
    anchor: z.string().catch('').default(''),
  })).catch([]).default([]),
})

export type QuestionCareV1 = z.infer<typeof questionCareV1Schema>

export interface StructureQuestionCareInput {
  questionText: string
  topic: string
  goal: string
  scaleType: string
  systemPromptOverride?: string
  probeLimitPerElement?: number
  probeLimitPerQuestion?: number
}

export const DEFAULT_STRUCTURE_CARE_PROMPT = `РОЛЬ: Ты — методолог структурированных интервью по компетенциям. Ты владеешь методикой CARE (Context — ситуация, Action — действия лично кандидата, Result — результат, Evaluate — выводы и рефлексия) и умеешь раскладывать вопрос на эти четыре блока так, чтобы интервью шло от общего к частному.

ВХОД:
— Формулировка вопроса: {{question_text}}
— Тема оценки: {{topic}}
— Цель оценки: {{goal}}
— Тип шкалы интерпретации: {{scale_type}}

ЗАДАЧА:
1. Проверь, является ли вопрос открытым и одиночным. Если нет — предложи исправленную формулировку в поле revisedQuestion (иначе оставь его пустым, а isOpenSingle = true).
2. Разложи вопрос на четыре блока CARE (context, action, result, evaluate).
3. Для каждого блока дай 2–3 уточняющих вопроса (probe), ведущих от общего к частному. Не более 3 на блок.
4. Для каждого блока опиши признак достаточного ответа (sufficientSignal) и признак ухода от ответа (evasionSignal).
5. Предложи 3 ожидаемых свидетельства (expectedEvidence).
6. Предложи по 3 зелёных (greenFlags) и 3 красных (redFlags) флага.
7. Предложи якоря для шкалы {{scale_type}} (scaleAnchors: значение → поведенческий якорь), опираясь на поведение кандидата, а не на оценку интервьюера.

ПРАВИЛА УТОЧНЕНИЙ (probe-триггеры организации):
{{probe_rules}}
Используй эти правила: если формулировка ответа может вызвать соответствующий сигнал — предложи связанный probe.

ЗАПРЕТЫ:
— Не добавляй подсказку правильного ответа и не наводи на желаемый ответ.
— Не используй чувствительные признаки (возраст, пол, национальность, религия, семейное положение, здоровье).
— Не объединяй две гипотезы/предмета в один вопрос.
— Не оценивай кандидата — только описывай наблюдаемое поведение.

ФОРМАТ: строго JSON по схеме question_care_v1. Без markdown, без пояснений.`

function buildUserPrompt(input: StructureQuestionCareInput): string {
  return `Вопрос: ${input.questionText}
Тема: ${input.topic}
Цель: ${input.goal}
Тип шкалы: ${input.scaleType}

Разложи вопрос по CARE.`
}

/** Детерминированная пост-обработка: 4 элемента, лимиты probe, тримминг. */
function postProcess(raw: QuestionCareV1, perElement: number, perQuestion: number): QuestionCareV1 {
  const byElement = new Map<CareElement, typeof raw.elements[number]>()
  for (const el of raw.elements) {
    if (!byElement.has(el.element)) byElement.set(el.element, el)
  }
  // Гарантировать ровно 4 блока в каноническом порядке.
  const elements = CARE_ORDER.map((el) => {
    const found = byElement.get(el)
    const probes = (found?.probes ?? [])
      .map(p => p.trim())
      .filter(Boolean)
      .slice(0, Math.max(perElement, 0))
    return {
      element: el,
      probes,
      sufficientSignal: (found?.sufficientSignal ?? '').trim(),
      evasionSignal: (found?.evasionSignal ?? '').trim(),
    }
  })

  // Ограничить суммарное число probe, приоритет action → result → context → evaluate.
  const priority: CareElement[] = ['action', 'result', 'context', 'evaluate']
  let total = elements.reduce((n, e) => n + e.probes.length, 0)
  while (total > perQuestion) {
    for (const el of [...priority].reverse()) {
      const block = elements.find(e => e.element === el)
      if (block && block.probes.length > 0) {
        block.probes.pop()
        total--
        if (total <= perQuestion) break
      }
    }
  }

  return {
    isOpenSingle: raw.isOpenSingle,
    revisedQuestion: raw.revisedQuestion.trim(),
    elements,
    expectedEvidence: raw.expectedEvidence.map(s => s.trim()).filter(Boolean).slice(0, 5),
    greenFlags: raw.greenFlags.map(s => s.trim()).filter(Boolean).slice(0, 5),
    redFlags: raw.redFlags.map(s => s.trim()).filter(Boolean).slice(0, 5),
    scaleAnchors: raw.scaleAnchors.filter(a => a.value.trim() || a.anchor.trim()),
  }
}

export async function structureQuestionCare(
  config: ProviderConfig,
  input: StructureQuestionCareInput,
): Promise<QuestionCareV1> {
  const perElement = input.probeLimitPerElement ?? 3
  const perQuestion = input.probeLimitPerQuestion ?? 6

  const result = await withAiOperation({ operation: 'questionBank.structureCare' }, () => generateStructuredOutput(config, {
    system: input.systemPromptOverride ?? DEFAULT_STRUCTURE_CARE_PROMPT,
    prompt: buildUserPrompt(input),
    schema: questionCareV1Schema,
    schemaName: 'question_care_v1',
    schemaDescription: 'Разложение вопроса по методике CARE',
    wrapBareArray: items => ({ elements: items }),
    temperature: 0.2,
  }))

  return postProcess(result.object, perElement, perQuestion)
}
