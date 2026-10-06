/**
 * Пользовательские подписи к enum'ам карты поиска.
 * Единственный источник для экрана, документа и экспорта — docs/tz-search-map-v2.md §1.
 *
 * В БД и API сущность по-прежнему называется «segment»; для пользователя — «гипотеза поиска».
 */

export const LAYER_LABELS: Record<string, string> = {
  core: 'Ядро',
  adjacent: 'Смежный круг',
  school: 'Школы компетенций',
  alumni: 'Alumni',
  custom: 'Своё',
}

export const LAYER_HINTS: Record<string, string> = {
  core: 'где работают прямые аналоги',
  adjacent: 'похожая функция, другой контекст',
  school: 'где учат нужному',
  alumni: 'откуда уже приходили к нам',
  custom: 'добавлено рекрутёром',
}

export const LAYER_ORDER = ['core', 'adjacent', 'school', 'alumni', 'custom'] as const

export const PRIORITY_LABELS: Record<string, string> = {
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
}

export const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

export const HYPOTHESIS_STATUS_LABELS: Record<string, string> = {
  untested: 'Не проверена',
  in_progress: 'В работе',
  working: 'Работает',
  rejected: 'Отклонена',
}

/** Порядок статусов в таблице: сначала то, что даёт результат, в конце — отклонённые. */
export const HYPOTHESIS_STATUS_ORDER: Record<string, number> = {
  working: 0, in_progress: 1, untested: 2, rejected: 3,
}

export const SECTION_TYPE_LABELS: Record<string, string> = {
  title_synonyms: 'Как называют должность',
  keywords: 'Ключевые навыки и слова',
  geo: 'География и формат',
  exclusions: 'Кого не ищем',
  notes: 'Заметки и договорённости',
}

export const ORIGIN_LABELS: Record<string, string> = {
  ai: 'предложено моделью',
  manual: 'добавлено вручную',
  template: 'из шаблона',
}

export const VERSION_TRIGGER_LABELS: Record<string, string> = {
  manual: 'вручную',
  sources_changed: 'изменились источники',
  ai_generated: 'ИИ-генерация',
  calibration: 'калибровка с HM',
  restore: 'восстановление',
}

export const SCORE_LABELS = {
  poolEstimate: 'Пул',
  responseLikelihood: 'Отклик',
  accessDifficulty: 'Доступ',
} as const

export function layerLabel(layer?: string | null): string {
  if (!layer) return '—'
  return LAYER_LABELS[layer] ?? layer
}

export function priorityLabel(priority?: string | null): string {
  if (!priority) return '—'
  return PRIORITY_LABELS[priority] ?? priority
}

export function statusLabel(status?: string | null): string {
  if (!status) return '—'
  return HYPOTHESIS_STATUS_LABELS[status] ?? status
}
