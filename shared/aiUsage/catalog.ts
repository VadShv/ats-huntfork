/**
 * Каталог ИИ-операций — единый источник для учёта расхода (docs/tz-ai-usage.md §5).
 *
 * Ключ операции совпадает с `id` записи Банка промптов (server/utils/ai/promptRegistry.ts),
 * поэтому промпт, модель и стоимость операции видны в одном месте.
 * Файл shared: используется сервером (атрибуция событий, агрегаты) и клиентом
 * (подписи на дашборде «Расход ИИ»).
 */

export const AI_FEATURES = [
  'screening', 'resume', 'verification', 'interview', 'question_bank',
  'search_map', 'sourcing', 'comms', 'assistant', 'extension',
  'collaboration', 'prompt_lab', 'system', 'unattributed',
] as const
export type AiFeature = typeof AI_FEATURES[number]

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  screening: 'Скрининг и критерии',
  resume: 'Разбор резюме',
  verification: 'Проверка кандидатов',
  interview: 'Интервью и опросные карты',
  question_bank: 'Банк вопросов',
  search_map: 'Карта поиска',
  sourcing: 'Сорсинг hh',
  comms: 'Коммуникации',
  assistant: 'ИИ-ассистент',
  extension: 'Sidekick (расширение)',
  collaboration: 'Комментарии и обсуждения',
  prompt_lab: 'Банк промптов (песочница)',
  system: 'Служебное',
  unattributed: 'Без атрибуции',
}

/** Порядок и цвета для графиков (стабильные, чтобы фича не «прыгала» по цветам). */
export const AI_FEATURE_COLORS: Record<AiFeature, string> = {
  screening: '#2563eb',
  resume: '#0891b2',
  verification: '#7c3aed',
  interview: '#db2777',
  question_bank: '#c026d3',
  search_map: '#059669',
  sourcing: '#65a30d',
  comms: '#ea580c',
  assistant: '#d97706',
  extension: '#0d9488',
  collaboration: '#4f46e5',
  prompt_lab: '#64748b',
  system: '#94a3b8',
  unattributed: '#dc2626',
}

export const AI_TRIGGERS = ['user', 'background', 'extension', 'system'] as const
export type AiTrigger = typeof AI_TRIGGERS[number]

export const AI_TRIGGER_LABELS: Record<AiTrigger, string> = {
  user: 'Вручную',
  background: 'Фоновые задачи',
  extension: 'Расширение',
  system: 'Системные',
}

export const AI_PURPOSES = ['analysis', 'structuring', 'interactive', 'chatbot'] as const
export type AiPurpose = typeof AI_PURPOSES[number]

export const AI_PURPOSE_LABELS: Record<AiPurpose, string> = {
  analysis: 'Анализ',
  structuring: 'Структурирование',
  interactive: 'Интерактив',
  chatbot: 'Чат-бот',
}

export const AI_ENTITY_TYPES = [
  'job', 'application', 'candidate', 'search_map', 'conversation', 'chatbot_conversation',
  'meeting_report', 'question', 'duplicate_pair', 'prompt_sandbox', 'ai_config',
] as const
export type AiEntityType = typeof AI_ENTITY_TYPES[number]

export const AI_STATUSES = ['ok', 'repaired', 'error', 'timeout', 'aborted'] as const
export type AiUsageStatus = typeof AI_STATUSES[number]

export const AI_STATUS_LABELS: Record<AiUsageStatus, string> = {
  ok: 'Успешно',
  repaired: 'Восстановлен JSON',
  error: 'Ошибка',
  timeout: 'Таймаут',
  aborted: 'Прерван',
}

export interface AiOperationDef {
  key: string
  label: string
  feature: AiFeature
  /** Назначение конфигурации ИИ, которое использует операция. */
  purpose?: AiPurpose
  defaultTrigger: AiTrigger
  entityType?: AiEntityType
  /** id записи Банка промптов (совпадает с key, кроме чат-бота). */
  promptId?: string
  /** От чего зависит цена операции — подсказка на дашборде. */
  costNote?: string
}

/** Сохраняет литеральный тип key, чтобы AiOperationKey был объединением ключей. */
const op = <const K extends string>(d: AiOperationDef & { key: K }) => d

export const AI_OPERATIONS = [
  // ── Скрининг ──
  op({ key: 'scoring.scoreApplication', label: 'Оценка отклика по критериям', feature: 'screening', purpose: 'analysis', defaultTrigger: 'user', entityType: 'application', promptId: 'scoring.scoreApplication', costNote: 'Растёт с длиной резюме и числом критериев' }),
  op({ key: 'scoring.generateCriteria', label: 'Генерация критериев оценки', feature: 'screening', purpose: 'analysis', defaultTrigger: 'user', entityType: 'job', promptId: 'scoring.generateCriteria' }),
  // ── Резюме ──
  op({ key: 'parsing.structureResume', label: 'Структурирование резюме', feature: 'resume', purpose: 'structuring', defaultTrigger: 'user', entityType: 'candidate', promptId: 'parsing.structureResume', costNote: 'Растёт с длиной документа' }),
  // ── Проверка кандидатов ──
  op({ key: 'risk.assessResumeRisk', label: 'Риск-анализ резюме', feature: 'verification', purpose: 'analysis', defaultTrigger: 'background', entityType: 'candidate', promptId: 'risk.assessResumeRisk' }),
  op({ key: 'dedup.aiArbiter', label: 'ИИ-арбитр дублей', feature: 'verification', purpose: 'analysis', defaultTrigger: 'user', entityType: 'duplicate_pair', promptId: 'dedup.aiArbiter' }),
  op({ key: 'summary.candidateAiSummary', label: 'ИИ-сводка кандидата', feature: 'verification', purpose: 'interactive', defaultTrigger: 'user', entityType: 'candidate', promptId: 'summary.candidateAiSummary' }),
  op({ key: 'extension.verification', label: 'Sidekick: верификация', feature: 'verification', purpose: 'interactive', defaultTrigger: 'extension', entityType: 'candidate', promptId: 'extension.verification' }),
  // ── Интервью ──
  op({ key: 'interview.generateQuestions', label: 'Вопросы к интервью по вакансии', feature: 'interview', purpose: 'analysis', defaultTrigger: 'user', entityType: 'job', promptId: 'interview.generateQuestions' }),
  op({ key: 'interview.personalizeQuestionnaire', label: 'Персонализация опросной карты', feature: 'interview', purpose: 'analysis', defaultTrigger: 'user', entityType: 'application', promptId: 'interview.personalizeQuestionnaire' }),
  op({ key: 'interview.report', label: 'Отчёт по интервью', feature: 'interview', purpose: 'analysis', defaultTrigger: 'background', entityType: 'meeting_report', promptId: 'interview.report', costNote: 'Растёт с длиной транскрипта (до 40 000 символов)' }),
  op({ key: 'extension.interviewCard', label: 'Sidekick: карточка интервью', feature: 'interview', purpose: 'interactive', defaultTrigger: 'extension', entityType: 'candidate', promptId: 'extension.interviewCard' }),
  // ── Банк вопросов ──
  op({ key: 'questionBank.generate', label: 'Генерация вопросов банка', feature: 'question_bank', purpose: 'analysis', defaultTrigger: 'user', entityType: 'question', promptId: 'questionBank.generate' }),
  op({ key: 'questionBank.structureCare', label: 'Структурирование вопроса по CARE', feature: 'question_bank', purpose: 'structuring', defaultTrigger: 'user', entityType: 'question', promptId: 'questionBank.structureCare' }),
  // ── Карта поиска ──
  op({ key: 'searchMap.sections', label: 'Карта поиска: секции', feature: 'search_map', purpose: 'structuring', defaultTrigger: 'user', entityType: 'search_map', promptId: 'searchMap.sections' }),
  op({ key: 'searchMap.donors', label: 'Карта поиска: компании-доноры', feature: 'search_map', purpose: 'analysis', defaultTrigger: 'user', entityType: 'search_map', promptId: 'searchMap.donors' }),
  op({ key: 'searchMap.segments', label: 'Карта поиска: гипотезы', feature: 'search_map', purpose: 'analysis', defaultTrigger: 'user', entityType: 'search_map', promptId: 'searchMap.segments' }),
  op({ key: 'searchMap.summary', label: 'Карта поиска: вердикт', feature: 'search_map', purpose: 'structuring', defaultTrigger: 'user', entityType: 'search_map', promptId: 'searchMap.summary' }),
  op({ key: 'searchMap.queryString', label: 'Карта поиска: запрос гипотезы', feature: 'search_map', purpose: 'analysis', defaultTrigger: 'user', entityType: 'search_map', promptId: 'searchMap.queryString' }),
  op({ key: 'extension.searchMap', label: 'Sidekick: карта поиска', feature: 'search_map', purpose: 'interactive', defaultTrigger: 'extension', entityType: 'job', promptId: 'extension.searchMap' }),
  // ── Сорсинг ──
  op({ key: 'sourcing.hhQuery', label: 'hh-запрос из описания вакансии', feature: 'sourcing', purpose: 'analysis', defaultTrigger: 'user', entityType: 'job', promptId: 'sourcing.hhQuery' }),
  // ── Коммуникации ──
  op({ key: 'assistant.commsAssistant', label: 'Суфлёр: черновик ответа', feature: 'comms', purpose: 'interactive', defaultTrigger: 'background', entityType: 'conversation', promptId: 'assistant.commsAssistant' }),
  op({ key: 'assistant.commsAutopilot', label: 'Суфлёр: автопилот', feature: 'comms', purpose: 'interactive', defaultTrigger: 'background', entityType: 'conversation', promptId: 'assistant.commsAssistant' }),
  op({ key: 'assistant.telegramFirstContact', label: 'Первый контакт в Telegram', feature: 'comms', purpose: 'interactive', defaultTrigger: 'user', entityType: 'application', promptId: 'assistant.commsAssistant' }),
  // ── Ассистент ──
  op({ key: 'chatbot.chat', label: 'Чат-бот и агенты', feature: 'assistant', purpose: 'chatbot', defaultTrigger: 'user', entityType: 'chatbot_conversation', promptId: 'chatbot.baseSystemPrompt', costNote: 'До 8 шагов с инструментами на одно сообщение' }),
  // ── Sidekick ──
  op({ key: 'extension.summarize.summary', label: 'Sidekick: саммари', feature: 'extension', purpose: 'interactive', defaultTrigger: 'extension', entityType: 'candidate', promptId: 'extension.summarize.summary' }),
  op({ key: 'extension.summarize.fit', label: 'Sidekick: соответствие вакансии', feature: 'extension', purpose: 'interactive', defaultTrigger: 'extension', entityType: 'candidate', promptId: 'extension.summarize.fit' }),
  op({ key: 'extension.summarize.fragment', label: 'Sidekick: фрагмент', feature: 'extension', purpose: 'interactive', defaultTrigger: 'extension', promptId: 'extension.summarize.fragment' }),
  op({ key: 'extension.summarize.questions', label: 'Sidekick: вопросы', feature: 'extension', purpose: 'interactive', defaultTrigger: 'extension', entityType: 'candidate', promptId: 'extension.summarize.questions' }),
  op({ key: 'extension.summarize.translate', label: 'Sidekick: перевод', feature: 'extension', purpose: 'interactive', defaultTrigger: 'extension', promptId: 'extension.summarize.translate' }),
  op({ key: 'extension.summarize.card', label: 'Sidekick: карточка', feature: 'extension', purpose: 'interactive', defaultTrigger: 'extension', entityType: 'candidate', promptId: 'extension.summarize.card' }),
  op({ key: 'extension.summarize.custom', label: 'Sidekick: свой промпт', feature: 'extension', purpose: 'interactive', defaultTrigger: 'extension', promptId: 'extension.summarize.custom' }),
  op({ key: 'extension.chat', label: 'Sidekick: чат', feature: 'extension', purpose: 'interactive', defaultTrigger: 'extension', promptId: 'extension.chat' }),
  // ── Комментарии ──
  op({ key: 'comments.summarize', label: 'Саммари обсуждения отклика', feature: 'collaboration', purpose: 'interactive', defaultTrigger: 'user', entityType: 'application', promptId: 'comments.summarize' }),
  op({ key: 'comments.aiThread', label: '@ИИ в треде комментариев', feature: 'collaboration', purpose: 'interactive', defaultTrigger: 'background', entityType: 'application', promptId: 'comments.aiThread' }),
  // ── Банк промптов ──
  op({ key: 'promptLab.sandboxTest', label: 'Песочница: тест промпта', feature: 'prompt_lab', defaultTrigger: 'user', entityType: 'prompt_sandbox', promptId: 'promptLab.sandboxTest' }),
  // ── Служебное ──
  op({ key: 'infra.testConnection', label: 'Проверка подключения', feature: 'system', defaultTrigger: 'system', entityType: 'ai_config', promptId: 'infra.testConnection' }),
] as const satisfies readonly AiOperationDef[]

export type AiOperationKey = typeof AI_OPERATIONS[number]['key']

export const UNATTRIBUTED_OPERATION = 'unattributed'

const BY_KEY = new Map<string, AiOperationDef>(AI_OPERATIONS.map(o => [o.key, o]))

export function getAiOperation(key: string | null | undefined): AiOperationDef | undefined {
  return key ? BY_KEY.get(key) : undefined
}

export function isAiOperationKey(key: string): key is AiOperationKey {
  return BY_KEY.has(key)
}

/** Подпись операции для UI; неизвестный ключ показываем как есть. */
export function aiOperationLabel(key: string): string {
  if (key === UNATTRIBUTED_OPERATION) return 'Без атрибуции'
  return BY_KEY.get(key)?.label ?? key
}

export function aiFeatureOf(key: string): AiFeature {
  return BY_KEY.get(key)?.feature ?? 'unattributed'
}

export function aiFeatureLabel(key: string): string {
  return (AI_FEATURE_LABELS as Record<string, string>)[key] ?? key
}

/** Операции, сгруппированные по фичам — дерево «фича → операции». */
export function aiOperationsByFeature(): Map<AiFeature, AiOperationDef[]> {
  const map = new Map<AiFeature, AiOperationDef[]>()
  for (const o of AI_OPERATIONS) {
    const list = map.get(o.feature) ?? []
    list.push(o)
    map.set(o.feature, list)
  }
  return map
}
