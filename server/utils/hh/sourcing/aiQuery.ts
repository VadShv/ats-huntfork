/**
 * AI-генератор сорсинг-запросов hh.ru из описания вакансии.
 *
 * Принимает текст JD + заголовок вакансии и просит LLM собрать структурированный
 * SourcingQuery: ключевые слова (с языком поиска hh.ru) + опционально опыт,
 * формат работы, форма занятости, проф. роль.
 *
 * Использует org-уровневую AI-конфигурацию (purpose='analysis').
 *
 * Никогда не возвращает personally identifiable info — только параметры поиска.
 *
 * Spec refs:
 *   - https://api.hh.ru/openapi/redoc (resume search)
 *   - https://hh.ru/article/1175 (язык поиска: AND/OR/NOT, кавычки, скобки, *)
 */
import { z } from 'zod'
import { loadAiConfig } from '../../ai/loadConfig'
import { generateStructuredOutput } from '../../ai/provider'
import {
  HH_EDUCATION,
  HH_EMPLOYMENT_FORM,
  HH_EXPERIENCE,
  HH_TEXT_FIELD,
  HH_TEXT_LOGIC,
  HH_WORK_FORMAT,
  type SourcingQuery,
  sourcingQuerySchema,
} from './query'

/**
 * AI возвращает упрощённую версию SourcingQuery — только те поля, которые
 * можно надёжно вывести из текста вакансии.
 *
 * НЕ просим у AI:
 *   - skill — hh.ru принимает только числовые ID из словаря /suggests/skills,
 *     генерация ID языковой моделью бессмысленна (получаем 400 bad argument).
 *     Все ключевые навыки уходят в `text` через язык поиска.
 *   - area/metro — это IDs регионов, человек выбирает в UI.
 *   - period/orderBy — задаются дефолтами после генерации.
 */
const aiQuerySchema = z
  .object({
    text: z.string().min(1).max(2000).describe(
      'Поисковая строка hh.ru на языке поиска (https://hh.ru/article/1175). ' +
      'Используй: AND / OR / NOT, "точные фразы" в двойных кавычках, ' +
      '(скобки для группировки), * как суффикс для wildcard. ' +
      'Сюда же — ВСЕ ключевые навыки/технологии (Python, Kubernetes, PostgreSQL и т.п.). ' +
      'НЕ дублируй в text зарплату, опыт, формат — для них есть отдельные поля.',
    ),
    textLogic: z.enum(HH_TEXT_LOGIC).optional().describe(
      'Логика text: all (все слова, по умолчанию) / any (любое) / phrase (точная фраза) / except (исключить). ' +
      'Обычно НЕ нужно указывать — оставь пустым, если используешь булеву логику внутри text.',
    ),
    textField: z.enum(HH_TEXT_FIELD).optional().describe(
      'В какой части резюме искать. По умолчанию everywhere. ' +
      'Если хочешь искать только в заголовке резюме (например, для точной должности) — поставь title. ' +
      'experience_position — должность в опыте работы.',
    ),
    experience: z.array(z.enum(HH_EXPERIENCE)).optional().describe(
      'Уровни опыта: noExperience, between1And3, between3And6, moreThan6. ' +
      'Заполняй ТОЛЬКО если JD явно требует определённый уровень.',
    ),
    employmentForm: z.array(z.enum(HH_EMPLOYMENT_FORM)).optional().describe(
      'Форма занятости (современный словарь hh): FULL, PART, PROJECT, FLY_IN_FLY_OUT. ' +
      'Обычно FULL для постоянных IT-вакансий — указывай только если в JD явно сказано иное.',
    ),
    workFormat: z.array(z.enum(HH_WORK_FORMAT)).optional().describe(
      'Формат работы (современный словарь hh): ON_SITE (офис), REMOTE (удалённо), HYBRID (гибрид), FIELD_WORK. ' +
      'Заполняй если в JD явно указано: «удалённо» → REMOTE, «гибрид» → HYBRID, «офис» → ON_SITE.',
    ),
    educationLevel: z.array(z.enum(HH_EDUCATION)).optional().describe(
      'Уровень образования. Заполняй ТОЛЬКО если JD явно требует диплом конкретного уровня.',
    ),
    salaryFrom: z.number().int().min(0).max(100_000_000).optional().describe(
      'Минимальная зарплата в RUR. Бери из JD только если указана; иначе пропусти.',
    ),
    professionalRole: z.array(z.string()).max(5).optional().describe(
      'ID профессиональных ролей из словаря hh.ru /professional_roles. ' +
      'Это ЧИСЛОВЫЕ ID, не названия. Примеры наиболее частых IT-ролей: ' +
      '"96" — Программист, разработчик; "104" — Системный администратор; ' +
      '"107" — Руководитель проектов; "10" — Аналитик; "165" — Тестировщик; ' +
      '"160" — Сетевой инженер; "157" — Системный аналитик; "36" — DevOps-инженер; ' +
      '"170" — UX/UI-дизайнер; "165" — QA-инженер; "73" — Менеджер по продукту; ' +
      '"25" — Дата-сайентист. ' +
      'Указывай 1–3 наиболее релевантные роли, если уверен. Если не уверен — пропусти.',
    ),
  })
  .strict()

const SYSTEM_PROMPT = `Ты — опытный IT-рекрутер, эксперт по поиску кандидатов в базе резюме hh.ru.
Твоя задача — собрать эффективный сорсинг-запрос из описания вакансии (JD).

КЛЮЧЕВОЕ ПОЛЕ — text. Используй язык поиска hh.ru (https://hh.ru/article/1175):
- AND     — обязательное И между группами требований
- OR      — синонимы и взаимозаменяемые варианты
- NOT     — исключение неподходящих ролей/уровней
- "..."   — точная фраза (двойные кавычки)
- (...)   — группировка
- *       — wildcard в КОНЦЕ слова (postgres* найдёт postgresql)

Правила построения text:
1. Включи в text ВСЕ ключевые навыки и технологии — отдельного поля skill нет
   (он принимает только числовые ID, которые ты не можешь знать).
2. Группируй синонимы через OR: (postgresql OR postgres OR "postgre sql")
3. Обязательные группы соединяй через AND: (python OR django) AND (postgresql OR mysql)
4. Исключай нерелевантное: NOT (стажёр OR intern OR junior) для senior-вакансий
5. Используй кавычки для многословных фраз: "machine learning", "data engineer"
6. Будь конкретен — не пиши "знание IT", пиши конкретные технологии.

ПРИМЕРЫ хорошего text:
- Backend Python: (python OR django OR flask OR fastapi) AND (postgresql OR mysql OR mongodb) AND (docker OR kubernetes) NOT интерн
- DevOps: (kubernetes OR k8s) AND (terraform OR ansible) AND (aws OR gcp OR yandex.cloud) AND (gitlab OR jenkins)
- Senior Frontend: ("senior frontend" OR "senior front-end") AND (react OR vue OR angular) AND typescript NOT junior

Другие поля:
- experience  — только если JD явно требует уровень.
- workFormat  — заполни если в JD сказано «удалённо»/«гибрид»/«офис».
- employmentForm — обычно FULL, не указывай явно если стандарт.
- professionalRole — 1–3 ID из списка ТОЛЬКО если ты уверен в соответствии.
- salaryFrom — только если прямо указано в JD.
- educationLevel — только если JD явно требует диплом.

НЕ ВЫДУМЫВАЙ. Если поле неоднозначно или не указано в JD — пропусти.
Ответ — строго валидный JSON по схеме.`

/**
 * Сгенерировать SourcingQuery из текста вакансии и заголовка.
 *
 * @param orgId — organization scope для AI config.
 * @param jobTitle — название вакансии (например, "Senior Python Developer").
 * @param jobDescription — полный текст JD.
 * @param preferConfigId — опциональный override конкретной AI-конфигурации.
 * @returns SourcingQuery, прошедший валидацию `sourcingQuerySchema`.
 */
export async function generateSearchQueryFromJd(
  orgId: string,
  jobTitle: string,
  jobDescription: string,
  preferConfigId?: string | null,
): Promise<{ query: SourcingQuery, usage: { promptTokens: number, completionTokens: number } }> {
  const config = await loadAiConfig(orgId, { purpose: 'analysis', preferId: preferConfigId ?? null })

  const prompt = `Вакансия: ${jobTitle}

Описание:
${jobDescription.slice(0, 8000)}

Составь сорсинг-запрос hh.ru. Помни: все навыки и технологии — в text через язык поиска hh, НЕ в skill.`

  const { object, usage } = await generateStructuredOutput(config, {
    system: SYSTEM_PROMPT,
    prompt,
    schema: aiQuerySchema,
    schemaName: 'HhSourcingQuery',
    schemaDescription: 'Структурированный поисковый запрос для базы резюме hh.ru',
  })

  // Валидируем через основной schema (он strict() и дропнет ошибки).
  // aiQuerySchema — подмножество, так что parse пройдёт.
  const query = sourcingQuerySchema.parse({
    ...object,
    // Дефолтные значения, которые UI обычно подставляет:
    period: 30,
    orderBy: 'publication_time' as const,
  })

  return { query, usage }
}

/** Список доступных операторов для подсказок в UI. */
export const HH_BOOLEAN_OPERATORS = ['AND', 'OR', 'NOT'] as const
