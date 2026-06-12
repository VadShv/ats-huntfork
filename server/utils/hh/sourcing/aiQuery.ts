/**
 * AI-генератор сорсинг-запросов hh.ru из описания вакансии.
 *
 * Принимает текст JD + заголовок вакансии и просит LLM собрать структурированный
 * SourcingQuery: ключевые слова + опционально опыт/расписание/зарплатная вилка.
 *
 * Использует org-уровневую AI-конфигурацию (purpose='analysis').
 *
 * Никогда не возвращает personally identifiable info — только параметры поиска.
 */
import { z } from 'zod'
import { loadAiConfig } from '../../ai/loadConfig'
import { generateStructuredOutput } from '../../ai/provider'
import {
  HH_EDUCATION,
  HH_EMPLOYMENT,
  HH_EXPERIENCE,
  HH_ORDER_BY,
  HH_PERIODS,
  HH_SCHEDULES,
  type SourcingQuery,
  sourcingQuerySchema,
} from './query'

/**
 * AI возвращает упрощённую версию SourcingQuery — только те поля, которые
 * можно надёжно вывести из текста вакансии. Регион, метро и id-словарей
 * остаются за человеком (UI-конструктор).
 */
const aiQuerySchema = z
  .object({
    text: z.string().min(1).max(2000).describe(
      'Поисковая строка hh.ru. Используй булевы операторы (AND/OR/NOT), кавычки для фраз. ' +
      'Пример: "(python OR django) AND (postgresql OR postgres) NOT интерн". ' +
      'НЕ включай зарплату, опыт или расписание — для этого есть отдельные поля.',
    ),
    experience: z.array(z.enum(HH_EXPERIENCE)).optional().describe(
      'Уровни опыта: noExperience, between1And3, between3And6, moreThan6. ' +
      'Указывай только если JD явно требует определённый уровень.',
    ),
    employment: z.array(z.enum(HH_EMPLOYMENT)).optional().describe(
      'Тип занятости: full, part, project, volunteer, probation.',
    ),
    schedule: z.array(z.enum(HH_SCHEDULES)).optional().describe(
      'График работы: fullDay, shift, flexible, remote, flyInFlyOut.',
    ),
    educationLevel: z.array(z.enum(HH_EDUCATION)).optional().describe(
      'Уровень образования. Заполняй только если JD явно требует диплом.',
    ),
    salaryFrom: z.number().int().min(0).max(100_000_000).optional().describe(
      'Минимальная зарплата в RUR. Бери из JD, если указана; иначе пропусти.',
    ),
    skill: z.array(z.string().max(100)).max(20).optional().describe(
      'Ключевые навыки/технологии из JD (до 20). По одному навыку на элемент. ' +
      'Только конкретика: "Python", "Kubernetes", "PostgreSQL" — НЕ "знание ИТ".',
    ),
  })
  .strict()

const SYSTEM_PROMPT = `Ты — опытный IT-рекрутер, специалист по поиску кандидатов на hh.ru.
Твоя задача — составить эффективный сорсинг-запрос для базы резюме hh.ru
из описания вакансии (JD).

Правила:
1. text — главное поле. Собери из ключевых слов, обязательно через булевы операторы:
   - AND между обязательными группами
   - OR внутри взаимозаменяемых вариантов (синонимов, версий)
   - NOT для исключения неподходящих ролей
   - Кавычки для фраз: "machine learning"
2. Не дублируй то же самое в text и skill — text задаёт булеву логику, skill — точное соответствие тегам.
3. experience и educationLevel заполняй ТОЛЬКО если JD явно требует.
4. Не придумывай зарплату, если её нет в JD.
5. Ответ — строго валидный JSON по схеме.`

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

Составь сорсинг-запрос hh.ru.`

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
