/**
 * Детерминированные проверки качества формулировки вопроса банка (Спринт 1).
 * Без LLM. Возвращает блокирующие ошибки и предупреждения.
 * docs/tz-questions-01-org-bank.md §1.4
 */
import { normalizeQuestion } from '../text/normalizeQuestion'

export interface QualityIssue {
  code: string
  message: string
}

export interface QualityResult {
  blocking: QualityIssue[]
  warnings: QualityIssue[]
}

// Эвристика «закрытого» вопроса: начинается с конструкции да/нет.
const CLOSED_STARTERS = [
  'есть ли', 'был ли', 'была ли', 'были ли', 'можете ли', 'умеете ли', 'знаете ли',
  'делали ли', 'приходилось ли', 'готовы ли', 'хотите ли', 'нравится ли', 'считаете ли',
]

// Оценочная лексика (для якорей и как мягкий сигнал в вопросе).
const EVALUATIVE_WORDS = [
  'отличн', 'прекрасн', 'слаб', 'сильн', 'хорош', 'плох', 'великолепн', 'ужасн',
  'блестящ', 'посредствен', 'превосходн',
]

/**
 * Проверка вопроса банка.
 * @param text — формулировка
 * @param opts — контекст: заполнены ли тема/цель, статус темы, существующие тексты для дедупа
 */
export function checkQuestionQuality(
  text: string,
  opts: {
    hasTopic: boolean
    hasGoal: boolean
    topicActive: boolean
    expectedSignal?: string | null
    existingNormalized?: Set<string>
  },
): QualityResult {
  const blocking: QualityIssue[] = []
  const warnings: QualityIssue[] = []
  const trimmed = (text ?? '').trim()
  const lower = trimmed.toLowerCase()

  // ── Блокирующие ──
  if (trimmed.length === 0) {
    blocking.push({ code: 'empty', message: 'Текст вопроса пуст' })
  }
  if (trimmed.length > 600) {
    blocking.push({ code: 'too_long_hard', message: 'Текст вопроса длиннее 600 символов' })
  }
  if (!opts.hasTopic) {
    blocking.push({ code: 'no_topic', message: 'Не выбрана тема оценки' })
  }
  if (!opts.hasGoal) {
    blocking.push({ code: 'no_goal', message: 'Не заполнена цель вопроса' })
  }
  if (opts.hasTopic && !opts.topicActive) {
    blocking.push({ code: 'topic_not_active', message: 'Тема не в статусе «активна»' })
  }

  // ── Предупреждения ──
  if (CLOSED_STARTERS.some(s => lower.startsWith(s))) {
    warnings.push({ code: 'closed_question', message: 'Вопрос выглядит закрытым (ответ да/нет). Переформулируйте как открытый.' })
  }
  // Двойной вопрос: союз « и » между двумя предметами (грубая эвристика).
  if (/\sи\s/.test(lower) && trimmed.split(/\sи\s/).length > 1 && /[?]/.test(trimmed)) {
    const parts = trimmed.split(/\sи\s/)
    if (parts.length >= 2 && parts.every(p => p.trim().length > 15)) {
      warnings.push({ code: 'double_question', message: 'Возможно, вопрос проверяет две гипотезы (союз «и»). Разделите на два.' })
    }
  }
  if (trimmed.length > 300) {
    warnings.push({ code: 'too_long_soft', message: 'Длина более 300 символов — вопрос может быть тяжёл для восприятия.' })
  }
  if (opts.existingNormalized && opts.existingNormalized.has(normalizeQuestion(trimmed))) {
    warnings.push({ code: 'possible_duplicate', message: 'Похожий вопрос уже есть в банке (совпадение по нормализованному тексту).' })
  }
  if (!opts.expectedSignal || opts.expectedSignal.trim() === '') {
    warnings.push({ code: 'no_expected_signal', message: 'Не указан признак сильного ответа (expectedSignal).' })
  }

  return { blocking, warnings }
}

/** Проверка BARS-якоря: поведенческий, а не оценочный. */
export function checkAnchorQuality(anchorText: string): QualityResult {
  const blocking: QualityIssue[] = []
  const warnings: QualityIssue[] = []
  const trimmed = (anchorText ?? '').trim()
  const lower = trimmed.toLowerCase()

  if (trimmed.length === 0) {
    blocking.push({ code: 'empty', message: 'Текст якоря пуст' })
  }
  if (EVALUATIVE_WORDS.some(w => lower.includes(w))) {
    warnings.push({ code: 'evaluative_anchor', message: 'Якорь содержит оценочную лексику. Опишите наблюдаемое поведение, а не оценку.' })
  }
  return { blocking, warnings }
}

/** Можно ли публиковать: нет блокирующих ошибок. */
export function canPublish(result: QualityResult): boolean {
  return result.blocking.length === 0
}
