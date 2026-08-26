/**
 * AI Scoring Engine
 *
 * Evaluates candidates against job-specific scoring criteria using LLMs.
 * Produces structured, evidence-based scores with confidence ratings.
 */
import { z } from 'zod'
import { generateStructuredOutput, type ProviderConfig } from './provider'

// ─── Scoring Output Schema ────────────────────────────────────────

/** Schema for a single criterion evaluation from the LLM */
const criterionEvaluationSchema = z.object({
  criterionKey: z.string(),
  maxScore: z.number().int().min(0),
  applicantScore: z.number().int().min(0),
  confidence: z.number().min(0).max(100).int(),
  evidence: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
})

/** Full scoring response from the LLM */
const scoringResponseSchema = z.object({
  evaluations: z.array(criterionEvaluationSchema),
  summary: z.string(),
})

export type CriterionEvaluation = z.infer<typeof criterionEvaluationSchema>
export type ScoringResponse = z.infer<typeof scoringResponseSchema>

// ─── Criterion Definition ─────────────────────────────────────────

export interface CriterionDefinition {
  key: string
  name: string
  description: string | null
  category: string
  maxScore: number
  weight: number
}

// ─── Pre-made Criteria Templates ──────────────────────────────────

export const PREMADE_CRITERIA: Record<string, CriterionDefinition[]> = {
  standard: [
    {
      key: 'technical_skills',
      name: 'Технические навыки',
      description: 'Оцени технические компетенции, инструменты, языки программирования и фреймворки, указанные в резюме, и сопоставь их с требованиями вакансии.',
      category: 'technical',
      maxScore: 10,
      weight: 50,
    },
    {
      key: 'relevant_experience',
      name: 'Релевантный опыт',
      description: 'Оцени годы и качество опыта, напрямую связанного с ролью. Учти отрасль, размер компании и зону ответственности.',
      category: 'experience',
      maxScore: 10,
      weight: 50,
    },
    {
      key: 'education_fit',
      name: 'Образование и сертификаты',
      description: 'Оцени образование и профессиональные сертификаты, релевантные требованиям позиции.',
      category: 'education',
      maxScore: 10,
      weight: 30,
    },
  ],
  technical: [
    {
      key: 'core_tech_stack',
      name: 'Соответствие основному стеку',
      description: 'Насколько технические навыки кандидата соответствуют ключевым технологиям, требуемым для этой роли.',
      category: 'technical',
      maxScore: 10,
      weight: 70,
    },
    {
      key: 'system_design',
      name: 'Системный дизайн и архитектура',
      description: 'Свидетельства опыта проектирования систем, мышления о масштабировании и принятия архитектурных решений.',
      category: 'technical',
      maxScore: 10,
      weight: 50,
    },
    {
      key: 'engineering_practices',
      name: 'Инженерные практики',
      description: 'Тестирование, CI/CD, code review, документация и опыт работы с жизненным циклом разработки.',
      category: 'technical',
      maxScore: 10,
      weight: 40,
    },
    {
      key: 'relevant_experience',
      name: 'Релевантный опыт',
      description: 'Годы и глубина опыта в похожих ролях, проектах или доменах.',
      category: 'experience',
      maxScore: 10,
      weight: 50,
    },
    {
      key: 'leadership_collab',
      name: 'Лидерство и коммуникация',
      description: 'Свидетельства менторинга, тех-лидерства, кросс-командного взаимодействия и коммуникационных навыков.',
      category: 'soft_skills',
      maxScore: 10,
      weight: 30,
    },
  ],
  non_technical: [
    {
      key: 'relevant_experience',
      name: 'Релевантный опыт',
      description: 'Глубина и широта опыта, напрямую применимого к обязанностям роли.',
      category: 'experience',
      maxScore: 10,
      weight: 60,
    },
    {
      key: 'communication',
      name: 'Коммуникационные навыки',
      description: 'Свидетельства навыков письменной и устной коммуникации из качества резюме, сопроводительного письма и описанных достижений.',
      category: 'soft_skills',
      maxScore: 10,
      weight: 50,
    },
    {
      key: 'domain_knowledge',
      name: 'Знание предметной области',
      description: 'Релевантная отраслевая экспертиза, демонстрирующая понимание бизнес-контекста.',
      category: 'experience',
      maxScore: 10,
      weight: 40,
    },
    {
      key: 'education_fit',
      name: 'Образование и сертификаты',
      description: 'Образование и сертификаты, релевантные позиции.',
      category: 'education',
      maxScore: 10,
      weight: 30,
    },
    {
      key: 'culture_fit',
      name: 'Культурное соответствие',
      description: 'Индикаторы совпадения с ценностями компании, стилем работы и культурой команды на основе карьерной траектории и интересов.',
      category: 'culture',
      maxScore: 10,
      weight: 30,
    },
  ],
}

// ─── Rubric Generation from Job Description ───────────────────────

const generatedCriteriaSchema = z.object({
  criteria: z.array(z.object({
    key: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.enum(['technical', 'experience', 'soft_skills', 'education', 'culture', 'custom']),
    maxScore: z.number().int().min(1).max(10).describe('Always use 10'),
    suggestedWeight: z.number().int().min(10).max(100),
  })),
})

/**
 * Use AI to generate scoring criteria from a job description.
 * Returns 4–6 criteria tailored to the specific role.
 */
export async function generateCriteriaFromDescription(
  config: ProviderConfig,
  jobTitle: string,
  jobDescription: string,
): Promise<CriterionDefinition[]> {
  const result = await generateStructuredOutput(config, {
    system: `Ты — опытный HR-аналитик, который создаёт объективные и непредвзятые критерии оценки кандидатов.
Твоя задача — проанализировать описание вакансии и сформировать 4–6 измеримых критериев оценки.

Правила:
— Каждый критерий должен быть конкретным и измеримым на основе резюме/CV.
— Избегай критериев, которые могут привнести дискриминацию (возраст, пол, этническая принадлежность, инвалидность).
— Фокусируйся на навыках, опыте и квалификации, напрямую релевантных роли.
— Пиши ясным деловым русским языком. Названия критериев (name) и описания (description) всегда на русском.
— Каждый key должен быть уникальным, в нижнем регистре и использовать латинские буквы + подчёркивание (например, "react_expertise").
— suggestedWeight выше для более важных критериев (шкала 10–100).`,
    prompt: `Название вакансии: ${jobTitle}\n\nОписание вакансии:\n${jobDescription}`,
    schema: generatedCriteriaSchema,
    schemaName: 'GeneratedCriteria',
    schemaDescription: 'Критерии оценки, сгенерированные из описания вакансии',
  })

  return result.object.criteria.map((c, i) => ({
    key: c.key,
    name: c.name,
    description: c.description,
    category: c.category,
    maxScore: c.maxScore,
    weight: c.suggestedWeight,
  }))
}

// ─── Score Application ────────────────────────────────────────────

/**
 * Score a single application against the job's scoring criteria.
 * Returns structured evaluations for each criterion.
 */
export async function scoreApplication(
  config: ProviderConfig,
  params: {
    jobTitle: string
    jobDescription: string
    criteria: CriterionDefinition[]
    resumeText: string
    coverLetterText?: string | null
    applicationNotes?: string | null
  },
): Promise<{ scoring: ScoringResponse; usage: { promptTokens: number; completionTokens: number } }> {
  const criteriaBlock = params.criteria
    .map((c, i) => `${i + 1}. **${c.name}** (criterionKey: "${c.key}", max: ${c.maxScore})\n   ${c.description ?? 'Описание не указано.'}`)
    .join('\n\n')

  const expectedKeysList = params.criteria.map(c => `"${c.key}"`).join(', ')

  const candidateInfo = [
    `РЕЗЮМЕ:\n${params.resumeText}`,
    params.coverLetterText ? `\nСОПРОВОДИТЕЛЬНОЕ ПИСЬМО:\n${params.coverLetterText}` : '',
    params.applicationNotes ? `\nЗАМЕТКИ ПО ОТКЛИКУ:\n${params.applicationNotes}` : '',
  ].filter(Boolean).join('\n')

  const result = await generateStructuredOutput(config, {
    system: `Ты — опытный, непредвзятый эксперт по оценке кандидатов в ATS-системе.
Твоя задача — объективно оценить кандидата по заданным критериям для конкретной вакансии.

ВАЖНЫЕ ПРАВИЛА:
— Оценивай ТОЛЬКО на основе фактов, найденных в предоставленных материалах (резюме, сопроводительное письмо, заметки).
— Если информации по критерию нет, ставь низкий балл и укажи это в gaps (пробелах).
— Будь честным и последовательным — избегай предвзятости по имени, полу, возрасту или происхождению.
— confidence (уверенность) отражает, насколько много релевантной информации было доступно (шкала 0–100).
— evidence (доказательства) должны цитировать конкретные детали из материалов кандидата.
— Каждая сильная сторона (strength) и пробел (gap) — одно конкретное утверждение.
— applicantScore не должен превышать maxScore для каждого критерия.
— Сделай краткий summary (вывод) по общей оценке кандидата.

КРИТИЧЕСКИ ВАЖНО — КЛЮЧИ КРИТЕРИЕВ (criterionKey):
— Верни evaluations ДЛЯ КАЖДОГО критерия из списка (ни один не пропускай).
— В criterionKey вставляй РОВНО тот ключ (без изменений, перевода или переформулировки), который указан в скобках (criterionKey: "...") в блоке критериев.
— НЕ выдумывай новые ключи и НЕ объединяй критерии.
— Порядок evaluations должен совпадать с порядком критериев выше.

ЯЗЫК ОТВЕТА: ВСЕ поля ответа (summary, evidence, strengths, gaps) должны быть на РУССКОМ языке, даже если резюме или вакансия на английском. Пиши деловым, конкретным тоном.`,
    prompt: `НАЗВАНИЕ ВАКАНСИИ: ${params.jobTitle}

ОПИСАНИЕ ВАКАНСИИ:
${params.jobDescription}

КРИТЕРИИ ОЦЕНКИ (всего: ${params.criteria.length}):
${criteriaBlock}

ОЖИДАЕМЫЕ criterionKey в ответе (точно ${params.criteria.length} элементов, в том же порядке): [${expectedKeysList}]

МАТЕРИАЛЫ КАНДИДАТА:
${candidateInfo}

Оцени этого кандидата по каждому критерию. Верни ровно ${params.criteria.length} элементов в evaluations, используя criterionKey из списка выше без изменений. Ответ на русском языке.`,
    schema: scoringResponseSchema,
    schemaName: 'CandidateScoring',
    schemaDescription: 'Структурированная оценка кандидата с баллами по каждому критерию',
  })

  // Clamp applicantScore to maxScore — LLMs may occasionally exceed the maximum
  for (const evaluation of result.object.evaluations) {
    evaluation.applicantScore = Math.min(evaluation.applicantScore, evaluation.maxScore)
  }

  // ─── Защита от рассогласованных criterionKey ───
  // Нет гарантии, что LLM вернёт ключ 1:1 — принудительно выравниваем ответ
  // со списком критериев вакансии, чтобы UI всегда получал оценку по каждому критерию.
  const expectedKeys = new Set(params.criteria.map(c => c.key))
  const returnedKeys = new Set(result.object.evaluations.map(e => e.criterionKey))
  const missingKeys = params.criteria.filter(c => !returnedKeys.has(c.key)).map(c => c.key)
  const extraKeys = result.object.evaluations.filter(e => !expectedKeys.has(e.criterionKey)).map(e => e.criterionKey)

  // 1) Фильтруем фантомные ключи (выдуманные LLM)
  if (extraKeys.length > 0) {
    result.object.evaluations = result.object.evaluations.filter(e => expectedKeys.has(e.criterionKey))
  }

  // 2) Zero-fill пропущенные критерии — без данных confidence=0 => UI покажет «Требуется ручная проверка»
  for (const criterion of params.criteria) {
    if (!returnedKeys.has(criterion.key)) {
      result.object.evaluations.push({
        criterionKey: criterion.key,
        maxScore: criterion.maxScore,
        applicantScore: 0,
        confidence: 0,
        evidence: 'LLM не вернула оценку по этому критерию. Требуется ручная проверка.',
        strengths: [],
        gaps: ['LLM не смогла оценить кандидата по этому критерию.'],
      })
    }
  }

  // 3) Логгируем рассогласование (мониторинг плавающих ключей от LLM)
  if (missingKeys.length > 0 || extraKeys.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[scoring] LLM key mismatch', {
      jobTitle: params.jobTitle,
      expected: [...expectedKeys],
      returned: [...returnedKeys],
      missing: missingKeys,
      extra: extraKeys,
    })
  }

  return {
    scoring: result.object,
    usage: result.usage,
  }
}

/**
 * Compute a weighted composite score (0–100) from individual criterion scores.
 */
export function computeCompositeScore(
  criteria: CriterionDefinition[],
  evaluations: CriterionEvaluation[],
): number {
  let totalWeightedScore = 0
  let totalWeight = 0

  for (const criterion of criteria) {
    const evaluation = evaluations.find(e => e.criterionKey === criterion.key)
    if (!evaluation) continue

    const normalizedScore = (evaluation.applicantScore / evaluation.maxScore) * 100
    totalWeightedScore += normalizedScore * criterion.weight
    totalWeight += criterion.weight
  }

  if (totalWeight === 0) return 0
  return Math.round(totalWeightedScore / totalWeight)
}

/**
 * Средняя взвешенная уверенность AI (0–100) по всем критериям.
 *
 * Используется в правиле авто-отказа: если composite confidence < 50%,
 * заявку НЕ отклоняем автоматически, а подсвечиваем бэджем «AI не уверен» и отдаём рекрутёру
 * на ручную проверку.
 *
 * Веса критериев — те же самые, что в computeCompositeScore: значимый критерий
 * сильнее влияет на итоговую уверенность.
 */
export function computeCompositeConfidence(
  criteria: CriterionDefinition[],
  evaluations: CriterionEvaluation[],
): number {
  let totalWeightedConfidence = 0
  let totalWeight = 0

  for (const criterion of criteria) {
    const evaluation = evaluations.find(e => e.criterionKey === criterion.key)
    if (!evaluation) continue

    totalWeightedConfidence += evaluation.confidence * criterion.weight
    totalWeight += criterion.weight
  }

  if (totalWeight === 0) return 0
  return Math.round(totalWeightedConfidence / totalWeight)
}
