/**
 * Детерминированный импорт пресета в карту вакансии (Спринт 3). 0 LLM.
 * Чистые функции маппинга + авто-матч критерия. Транзакция — в endpoint.
 * docs/tz-questions-03-presets-vacancy.md §3.5
 */
import { normalizeQuestion } from '../text/normalizeQuestion'

export type TopicType =
  | 'value' | 'soft_skill' | 'management' | 'professional' | 'motivation' | 'expectations'
  | 'factcheck' | 'achievement_scale' | 'career_logic' | 'risk_zone' | 'culture' | 'custom'

export type InterviewCategory =
  | 'hard_skill' | 'soft_skill' | 'experience' | 'motivation' | 'culture' | 'logistics' | 'risk_probe' | 'other'

/** Детерминированный маппинг типа темы → категория вопроса вакансии. */
export function topicTypeToCategory(type: TopicType): InterviewCategory {
  switch (type) {
    case 'professional':
    case 'management': return 'hard_skill'
    case 'soft_skill': return 'soft_skill'
    case 'achievement_scale':
    case 'career_logic': return 'experience'
    case 'motivation':
    case 'expectations': return 'motivation'
    case 'value':
    case 'culture': return 'culture'
    case 'factcheck':
    case 'risk_zone': return 'risk_probe'
    default: return 'other'
  }
}

export interface CriterionLite { id: string, key: string | null, name: string | null }

/**
 * Авто-матч критерия по нормализованному совпадению названия/кода темы с
 * key/name критерия. Нет уверенного совпадения → null (дыра в матрице).
 */
export function matchCriterion(
  topic: { name: string | null, code: string | null },
  criteria: CriterionLite[],
): string | null {
  const targets = [topic.name, topic.code].filter(Boolean).map(s => normalizeQuestion(s as string))
  if (!targets.length) return null
  for (const c of criteria) {
    const keys = [c.key, c.name].filter(Boolean).map(s => normalizeQuestion(s as string))
    if (keys.some(k => targets.includes(k))) return c.id
  }
  return null
}

export interface BankQuestionForImport {
  id: string
  version: number
  text: string
  goal: string | null
  expectedSignal: string | null
  status: string
}

export interface PresetSectionForImport {
  id: string
  topicId: string
  topicType: TopicType
  topicName: string | null
  topicCode: string | null
  goal: string | null
  displayOrder: number
  questions: { bankQuestion: BankQuestionForImport, isRequired: boolean, displayOrder: number }[]
}

export interface ImportRow {
  text: string
  category: InterviewCategory
  rationale: string | null
  goodAnswer: string | null
  linkMode: 'linked'
  sourceBankQuestionId: string
  sourceVersion: number
  presetId: string
  sectionRef: string
  criterionId: string | null
  displayOrder: number
}

/**
 * Собрать insert-строки из разделов пресета (детерминированно).
 * @param existingNormalized — множество нормализованных текстов уже в карте (для дедупа)
 * @param startOrder — displayOrder сдвиг (после текущего max)
 */
export function buildImportRows(opts: {
  presetId: string
  sections: PresetSectionForImport[]
  criteria: CriterionLite[]
  existingNormalized: Set<string>
  startOrder: number
}): { rows: ImportRow[], skippedDuplicates: number } {
  const rows: ImportRow[] = []
  let order = opts.startOrder
  let skipped = 0
  const seen = new Set(opts.existingNormalized)

  const sortedSections = [...opts.sections].sort((a, b) => a.displayOrder - b.displayOrder)
  for (const section of sortedSections) {
    const criterionId = matchCriterion({ name: section.topicName, code: section.topicCode }, opts.criteria)
    const category = topicTypeToCategory(section.topicType)
    const sortedQ = [...section.questions].sort((a, b) => a.displayOrder - b.displayOrder)
    for (const item of sortedQ) {
      const bq = item.bankQuestion
      if (bq.status !== 'published') continue // только published
      const norm = normalizeQuestion(bq.text)
      if (seen.has(norm)) { skipped++; continue }
      seen.add(norm)
      rows.push({
        text: bq.text,
        category,
        rationale: bq.goal || section.goal || null,
        goodAnswer: bq.expectedSignal || null,
        linkMode: 'linked',
        sourceBankQuestionId: bq.id,
        sourceVersion: bq.version,
        presetId: opts.presetId,
        sectionRef: section.id,
        criterionId,
        displayOrder: order++,
      })
    }
  }
  return { rows, skippedDuplicates: skipped }
}
