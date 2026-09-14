import type {
  AssessmentTopicType,
  ScaleType,
  TopicStatus,
} from './useAssessmentTopics'
import type {
  BankQuestionStatus,
  BankQuestionType,
  Complexity,
  InterviewStage,
} from './useBankQuestions'

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

interface Option { label: string; value: string }

// ─── Русские подписи enum-значений (для селектов и бейджей) ─────────────────

export const TOPIC_TYPE_LABELS: Record<AssessmentTopicType, string> = {
  value: 'Ценность',
  soft_skill: 'Soft skill',
  management: 'Управление',
  professional: 'Профессиональное',
  motivation: 'Мотивация',
  expectations: 'Ожидания',
  factcheck: 'Фактчек',
  achievement_scale: 'Шкала достижений',
  career_logic: 'Карьерная логика',
  risk_zone: 'Зона риска',
  culture: 'Культура',
  custom: 'Произвольная',
}

export const TOPIC_STATUS_LABELS: Record<TopicStatus, string> = {
  draft: 'Черновик',
  active: 'Активна',
  archived: 'В архиве',
}

export const SCALE_TYPE_LABELS: Record<ScaleType, string> = {
  numeric_5: 'Баллы 1–5',
  numeric_4: 'Баллы 1–4',
  numeric_3: 'Баллы 1–3',
  match_3: 'Соответствие (3)',
  verify_3: 'Верификация (3)',
  level_5: 'Уровни 0–4',
  custom: 'Произвольная',
}

export const QUESTION_TYPE_LABELS: Record<BankQuestionType, string> = {
  behavioral: 'Поведенческий',
  situational: 'Ситуационный',
  motivational: 'Мотивационный',
  factual: 'Фактический',
  verification: 'Верификационный',
  reflective: 'Рефлексивный',
  professional: 'Профессиональный',
  control: 'Контрольный',
  ai_personal: 'ИИ-персональный',
}

export const QUESTION_STATUS_LABELS: Record<BankQuestionStatus, string> = {
  draft: 'Черновик',
  published: 'Опубликован',
  archived: 'В архиве',
}

export const STAGE_LABELS: Record<InterviewStage, string> = {
  screening: 'Скрининг',
  recruiter: 'Рекрутёр',
  hiring_manager: 'Нанимающий менеджер',
  final: 'Финал',
  expert: 'Экспертное',
  full_cycle: 'Полный цикл',
}

export const COMPLEXITY_LABELS: Record<Complexity, string> = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
}

function toOptions<T extends string>(map: Record<T, string>): Option[] {
  return (Object.keys(map) as T[]).map(value => ({ value, label: map[value] }))
}

export function useQuestionBankLabels() {
  const topicTypeOptions = toOptions(TOPIC_TYPE_LABELS)
  const topicStatusOptions = toOptions(TOPIC_STATUS_LABELS)
  const scaleTypeOptions = toOptions(SCALE_TYPE_LABELS)
  const questionTypeOptions = toOptions(QUESTION_TYPE_LABELS)
  const questionStatusOptions = toOptions(QUESTION_STATUS_LABELS)
  const stageOptions = toOptions(STAGE_LABELS)
  const complexityOptions = toOptions(COMPLEXITY_LABELS)

  function topicStatusTone(status: TopicStatus): BadgeTone {
    switch (status) {
      case 'active': return 'success'
      case 'archived': return 'neutral'
      case 'draft':
      default: return 'warning'
    }
  }

  function questionStatusTone(status: BankQuestionStatus): BadgeTone {
    switch (status) {
      case 'published': return 'success'
      case 'archived': return 'neutral'
      case 'draft':
      default: return 'warning'
    }
  }

  return {
    TOPIC_TYPE_LABELS,
    TOPIC_STATUS_LABELS,
    SCALE_TYPE_LABELS,
    QUESTION_TYPE_LABELS,
    QUESTION_STATUS_LABELS,
    STAGE_LABELS,
    COMPLEXITY_LABELS,
    topicTypeOptions,
    topicStatusOptions,
    scaleTypeOptions,
    questionTypeOptions,
    questionStatusOptions,
    stageOptions,
    complexityOptions,
    topicStatusTone,
    questionStatusTone,
  }
}

export type { BadgeTone, Option }
