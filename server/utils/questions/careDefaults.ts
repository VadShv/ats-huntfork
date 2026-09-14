/**
 * Дефолтные (seed) артефакты методики CARE (Спринт 2).
 * Создаются лениво при первой инициализации методики org.
 * docs/tz-questions-02-care.md §6
 */
import { DEFAULT_STRUCTURE_CARE_PROMPT } from '../ai/structureQuestionCare'

export const CARE_DESCRIPTION_DEFAULT = `CARE — методика структурирования ответа кандидата на поведенческий вопрос.
• Context (Ситуация) — в какой ситуации, задаче, ограничениях действовал кандидат.
• Action (Действия) — что именно сделал ЛИЧНО кандидат (не команда, не «мы»).
• Result (Результат) — к чему привели действия, измеримо, с показателями.
• Evaluate (Выводы) — какие уроки извлёк, что сделал бы иначе, рефлексия.
Интервью ведём от общего к частному: сначала контекст, затем углубляемся в личный вклад, результат и выводы. Каждый блок сопровождается уточнениями (probe), которые включаются по триггерам ухода/обобщения.`

export const CARE_INTERVIEWER_INSTRUCTION_DEFAULT = `1. Задайте основной вопрос открыто, дайте кандидату развернуть ответ.
2. Ведите по CARE: если блок раскрыт слабо — задайте probe из списка блока.
3. Следите за триггерами (говорит «мы», нет показателей, теоретический ответ) и применяйте связанное уточнение.
4. Не наводите на правильный ответ, не оценивайте вслух.
5. Фиксируйте конкретику: ситуацию, личный вклад, цифры результата, выводы.
6. Достаточно 1 конкретного случая на вопрос — глубина важнее охвата.`

export const CARE_SUFFICIENCY_DEFAULT = {
  context: {
    sufficientSignal: 'Названа конкретная ситуация, задача, ограничения, срок',
    evasionSignal: 'Общие слова, «обычно», «всегда», нет конкретики',
    minEvidence: 1,
  },
  action: {
    sufficientSignal: 'Описаны действия от первого лица, видно личное решение',
    evasionSignal: '«Мы», пассив, теория без практики',
    minEvidence: 1,
  },
  result: {
    sufficientSignal: 'Назван измеримый итог с показателем',
    evasionSignal: '«Всё получилось», нет цифр, присвоение результата отдела',
    minEvidence: 1,
  },
  evaluate: {
    sufficientSignal: 'Есть выводы, что сделал бы иначе',
    evasionSignal: 'Нет рефлексии, «всё было идеально»',
    minEvidence: 0,
  },
} as const

export interface CareProbeTriggerSeed {
  trigger: string
  recommendedProbe: string
  careElement: 'context' | 'action' | 'result' | 'evaluate' | null
}

export const CARE_PROBE_TRIGGERS_DEFAULT: CareProbeTriggerSeed[] = [
  { trigger: 'Говорит «мы» без разделения вклада', recommendedProbe: 'Что именно сделали вы лично?', careElement: 'action' },
  { trigger: 'Нет конкретной ситуации', recommendedProbe: 'Приведите конкретный случай из последнего года', careElement: 'context' },
  { trigger: 'Теоретический ответ', recommendedProbe: 'А как это было в вашей практике?', careElement: 'action' },
  { trigger: 'Пропущен результат', recommendedProbe: 'Чем закончилась история?', careElement: 'result' },
  { trigger: 'Нет показателей', recommendedProbe: 'Как измеряли результат?', careElement: 'result' },
  { trigger: 'Не объяснено решение', recommendedProbe: 'Какие варианты рассматривали и почему выбрали этот?', careElement: 'action' },
  { trigger: 'Присвоение результата подразделения', recommendedProbe: 'Какая часть результата зависела от ваших решений?', careElement: 'action' },
  { trigger: 'Уход от вопроса', recommendedProbe: 'Повторить вопрос в другой формулировке', careElement: null },
  { trigger: 'Нет выводов', recommendedProbe: 'Что бы сделали иначе?', careElement: 'evaluate' },
]

/** probeRules snapshot из триггеров (для care_methodology.probeRules). */
export function probeRulesFromTriggers(triggers: CareProbeTriggerSeed[]) {
  return triggers.map(t => ({
    trigger: t.trigger,
    recommendedProbe: t.recommendedProbe,
    careElement: t.careElement ?? 'any',
  }))
}

// ── Seed care_prompt (3 kind) ──
export const STRUCTURE_QUESTION_VARIABLES = [
  { name: 'question_text', description: 'Формулировка вопроса', required: true },
  { name: 'topic', description: 'Тема оценки (название/определение)', required: true },
  { name: 'goal', description: 'Цель оценки', required: true },
  { name: 'scale_type', description: 'Тип шкалы интерпретации', required: true },
  { name: 'probe_rules', description: 'Список probe-триггеров организации', required: false },
]

export const PERSONALIZE_VARIABLES = [
  { name: 'candidate_summary', description: 'Профиль кандидата (резюме, ключевые факты)', required: true },
  { name: 'job_context', description: 'Контекст вакансии (описание + бриф)', required: true },
  { name: 'questions_json', description: 'Каркас опросника (JSON)', required: true },
  { name: 'risk_findings', description: 'Находки риск-анализа', required: false },
]

export const REPORT_VARIABLES = [
  { name: 'transcript', description: 'Транскрипт интервью', required: true },
  { name: 'questionnaire_json', description: 'Персональный опросник (JSON)', required: true },
  { name: 'bars_anchors', description: 'BARS-якоря тем', required: true },
  { name: 'report_template', description: 'Шаблон отчёта', required: true },
]

export const PERSONALIZE_PROMPT_PLACEHOLDER = `РОЛЬ: Ты — методолог интервью. Заглушка промпта персонализации (детализируется в Спринте 4).
Персонализируй вопросы опросника под кандидата, сохраняя структуру CARE.
ВХОД: {{candidate_summary}} · {{job_context}} · {{questions_json}} · {{risk_findings}}
ФОРМАТ: строго JSON.`

export const REPORT_PROMPT_PLACEHOLDER = `РОЛЬ: Ты — аналитик интервью. Заглушка промпта генерации отчёта (детализируется в Спринте 5).
Сформируй отчёт по интервью на основе транскрипта, опросника и BARS-якорей.
ВХОД: {{transcript}} · {{questionnaire_json}} · {{bars_anchors}} · {{report_template}}
ФОРМАТ: строго JSON.`

export const CARE_PROMPT_SEEDS = [
  { kind: 'structure_question' as const, promptText: DEFAULT_STRUCTURE_CARE_PROMPT, variables: STRUCTURE_QUESTION_VARIABLES },
  { kind: 'personalize_questionnaire' as const, promptText: PERSONALIZE_PROMPT_PLACEHOLDER, variables: PERSONALIZE_VARIABLES },
  { kind: 'generate_report' as const, promptText: REPORT_PROMPT_PLACEHOLDER, variables: REPORT_VARIABLES },
]
