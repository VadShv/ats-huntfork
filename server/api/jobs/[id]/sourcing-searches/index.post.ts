/**
 * POST /api/jobs/:id/sourcing-searches
 *
 * Создать сохранённый сорсинг-запрос hh.ru для вакансии.
 *
 * Тело запроса (один из трёх режимов):
 *   1. { name, mode: 'manual', query: {...} }          — конструктор
 *   2. { name, mode: 'url', url: 'https://hh.ru/...' } — из URL hh.ru
 *   3. { name, mode: 'ai' }                            — AI из JD вакансии
 *
 * Опциональные поля:
 *   scheduleMinutes (default 1440 = 1/день, null = только вручную),
 *   autoRunEnabled  (default true),
 *   maxPagesPerRun  (default 10).
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hhAccount, hhSavedSearch, job } from '../../../../database/schema'
import { getHhAccountForUser } from '../../../../utils/hh/tokens'
import {
  normalizeHhQueryText,
  parseHhSearchUrl,
  sourcingQuerySchema,
} from '../../../../utils/hh/sourcing/query'
import { generateSearchQueryFromJd } from '../../../../utils/hh/sourcing/aiQuery'
import { createRateLimiter } from '../../../../utils/rateLimit'

const paramsSchema = z.object({ id: z.string().min(1) })

const bodySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('manual'),
    name: z.string().min(1).max(200),
    query: sourcingQuerySchema,
    scheduleMinutes: z.number().int().min(60).max(43_200).nullable().optional(),
    autoRunEnabled: z.boolean().optional(),
    maxPagesPerRun: z.number().int().min(1).max(40).optional(),
    maxCandidates: z.number().int().min(1).max(500).optional(),
  }),
  z.object({
    mode: z.literal('url'),
    name: z.string().min(1).max(200),
    url: z.string().url(),
    scheduleMinutes: z.number().int().min(60).max(43_200).nullable().optional(),
    autoRunEnabled: z.boolean().optional(),
    maxPagesPerRun: z.number().int().min(1).max(40).optional(),
    maxCandidates: z.number().int().min(1).max(500).optional(),
  }),
  z.object({
    mode: z.literal('ai'),
    name: z.string().min(1).max(200),
    scheduleMinutes: z.number().int().min(60).max(43_200).nullable().optional(),
    autoRunEnabled: z.boolean().optional(),
    maxPagesPerRun: z.number().int().min(1).max(40).optional(),
    maxCandidates: z.number().int().min(1).max(500).optional(),
  }),
])

// Лимитер только для AI-режима (он дорогой)
const aiLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 5,
  message: 'Слишком много AI-запросов на генерацию. Подождите немного.',
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id: jobId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  // Проверяем вакансию
  const jobRow = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true, title: true, description: true },
  })
  if (!jobRow) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  // Проверяем подключение hh
  const hh = await getHhAccountForUser(orgId, userId)
  if (!hh) {
    throw createError({
      statusCode: 422,
      statusMessage: 'hh.ru не подключён. Перейдите в Настройки → Интеграции → hh.ru.',
    })
  }

  // Получаем query согласно режиму
  let query: z.infer<typeof sourcingQuerySchema>
  let sourceUrl: string | null = null

  if (body.mode === 'manual') {
    query = body.query
  } else if (body.mode === 'url') {
    try {
      query = parseHhSearchUrl(body.url)
    } catch (e) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Не удалось разобрать URL hh.ru. Проверьте ссылку.',
      })
    }
    sourceUrl = body.url
  } else {
    // AI mode
    await aiLimiter(event)
    if (!jobRow.description) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Для AI-генерации запроса нужно описание вакансии. Добавьте описание сначала.',
      })
    }
    const result = await generateSearchQueryFromJd(orgId, jobRow.title, jobRow.description)
    query = result.query
  }

  // Нормализуем text — hh не любит «» / — (бывают в AI-ответах и при copy-paste)
  if (query.text) {
    query = { ...query, text: normalizeHhQueryText(query.text) }
  }

  // Дефолты планировщика
  const scheduleMinutes = body.scheduleMinutes === undefined ? 1440 : body.scheduleMinutes
  const autoRunEnabled = body.autoRunEnabled ?? true
  const maxPagesPerRun = body.maxPagesPerRun ?? 10
  const maxCandidates = body.maxCandidates ?? 200

  // При создании всегда делаем первый прогон через минуту — иначе пользователь
  // не увидит результаты. Дальнейшие прогоны — только если включён auto.
  const nextRunAt: Date | null = new Date(Date.now() + 60_000)

  const id = crypto.randomUUID()
  await db.insert(hhSavedSearch).values({
    id,
    organizationId: orgId,
    jobId,
    hhAccountId: hh.id,
    createdByUserId: userId,
    name: body.name,
    query: query as Record<string, unknown>,
    sourceUrl,
    scheduleMinutes,
    autoRunEnabled,
    maxPagesPerRun,
    maxCandidates,
    nextRunAt,
  })

  return {
    id,
    name: body.name,
    query,
    sourceUrl,
    scheduleMinutes,
    autoRunEnabled,
    maxPagesPerRun,
    maxCandidates,
    nextRunAt,
  }
})
