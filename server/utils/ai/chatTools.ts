/**
 * Chatbot tools — give the LLM safe, org-scoped read access to ATS data.
 *
 * Every tool:
 *   - Accepts a `ChatbotToolContext` with the authenticated org id and scope.
 *   - Re-validates the scope on every call (defence-in-depth — never trust the
 *     model to honour scope itself).
 *   - Returns plain JSON-serializable objects with only the fields useful to
 *     the model (no secrets, no internal IDs the user wouldn't recognise).
 *
 * Tools are intentionally small and composable. The model is expected to call
 * `list_*` to discover IDs, then `get_*` to fetch details.
 */
import { tool } from 'ai'
import { and, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  application,
  candidate,
  comment,
  criterionScore,
  document,
  interview,
  job,
  scoringCriterion,
} from '../../database/schema'
import { downloadFromS3 } from '../s3'
import { parseDocument } from '../resume-parser'
import type { ChatbotScope } from '../../../shared/chatbot'
import {
  CHATBOT_MAX_ATTACHMENT_CHARS,
  type ChatbotAttachment,
} from '../../../shared/chatbot'

export interface ChatbotToolContext {
  orgId: string
  scope: ChatbotScope
  /** Attachments uploaded with the current user message. */
  attachments: Array<ChatbotAttachment & { text: string }>
  /** Последнее сообщение юзера — fallback для слабых моделей (Qwen/Yandex), которые теряют параметры. */
  lastUserMessage?: string
}

/**
 * Извлекает ключевое слово для поиска из реплики юзера, если модель не передала query.
 * Нормализует русские сленговые формы в канонические технические термины.
 *
 * ВАЖНО: в JS \b не работает с кириллицей — приходится использовать (?<![\p{L}])...(?![\p{L}]).
 */
function extractQueryFromUserMessage(msg: string): string | null {
  if (!msg || msg.trim().length === 0) return null
  const lower = msg.toLowerCase()

  // Канонические RU→техническое преобразование (частые случаи в HR-запросах).
  const techMap: Array<[RegExp, string]> = [
    [/(?<![\p{L}])пито\p{L}*(?![\p{L}])/iu, 'Python'],
    [/(?<![\p{L}])python\p{L}*(?![\p{L}])/iu, 'Python'],
    [/(?<![\p{L}])(?:реакт\p{L}*|react\p{L}*)(?![\p{L}])/iu, 'React'],
    [/(?<![\p{L}])node(?:\.?js)?(?![\p{L}])/iu, 'Node.js'],
    [/(?<![\p{L}])vue\p{L}*(?![\p{L}])/iu, 'Vue'],
    [/(?<![\p{L}])angular\p{L}*(?![\p{L}])/iu, 'Angular'],
    [/(?<![\p{L}])(?:тайпскрипт|typescript)(?![\p{L}])/iu, 'TypeScript'],
    [/(?<![\p{L}])(?:джаваскрипт|javascript)(?![\p{L}])/iu, 'JavaScript'],
    [/(?<![\p{L}])(?:джава|java)(?![\p{L}])/iu, 'Java'],
    [/(?<![\p{L}])(?:котлин|kotlin)\p{L}*(?![\p{L}])/iu, 'Kotlin'],
    [/(?<![\p{L}])(?:свифт|swift)\p{L}*(?![\p{L}])/iu, 'Swift'],
    [/(?<![\p{L}])(?:гоу?ланг|golang)(?![\p{L}])/iu, 'Go'],
    [/(?<![\p{L}])(?:руби|ruby)\p{L}*(?![\p{L}])/iu, 'Ruby'],
    [/(?<![\p{L}])(?:пхп|php)\p{L}*(?![\p{L}])/iu, 'PHP'],
    [/(?<![\p{L}])(?:си[\s-]?шарп|c#|csharp)(?![\p{L}])/iu, 'C#'],
    [/(?<![\p{L}])(?:c\+\+|cpp)(?![\p{L}])/iu, 'C++'],
    [/(?<![\p{L}])(?:раст|rust)\p{L}*(?![\p{L}])/iu, 'Rust'],
    [/(?<![\p{L}])devops(?![\p{L}])/iu, 'DevOps'],
    [/(?<![\p{L}])(?:кубер\p{L}*|kubernetes|k8s)(?![\p{L}])/iu, 'Kubernetes'],
    [/(?<![\p{L}])(?:докер|docker)\p{L}*(?![\p{L}])/iu, 'Docker'],
    [/(?<![\p{L}])(?:бухгалтер\p{L}*|бухучёт\p{L}*|бухучет\p{L}*)(?![\p{L}])/iu, 'бухгалтер'],
    [/(?<![\p{L}])(?:дизайнер\p{L}*|дизайн\p{L}*|designer)(?![\p{L}])/iu, 'дизайнер'],
    [/(?<![\p{L}])(?:менеджер\p{L}*|manager)(?![\p{L}])/iu, 'менеджер'],
    [/(?<![\p{L}])(?:аналитик\p{L}*|analyst)(?![\p{L}])/iu, 'аналитик'],
    [/(?<![\p{L}])(?:тестировщик\p{L}*|qa)(?![\p{L}])/iu, 'QA'],
    [/(?<![\p{L}])(?:разработчик\p{L}*|developer)(?![\p{L}])/iu, 'разработчик'],
    [/(?<![\p{L}])(?:рекрут\p{L}*|recruiter)(?![\p{L}])/iu, 'рекрутер'],
    [/(?<![\p{L}])hr(?![\p{L}])/iu, 'HR'],
  ]
  for (const [re, canonical] of techMap) {
    if (re.test(lower)) return canonical
  }

  // Имя собственное: слова с заглавной буквы, кроме стоп-слов.
  const stopWords = new Set([
    'Найди', 'Найти', 'Покажи', 'Поиск', 'Кандидат', 'Кандидата', 'Кандидаты',
    'Подбери', 'Резюме', 'Вакансия', 'Сотрудник',
    'Проанализируй', 'Поищи', 'Поиски', 'Выбери',
  ])
  const properNouns = msg.match(/[А-ЯЁ][а-яё]+/g) ?? []
  const properCandidates = properNouns.filter(w => !stopWords.has(w))
  if (properCandidates.length > 0) {
    return properCandidates.slice(0, 2).join(' ')
  }

  return null
}

/** Throw if the requested job is outside the active scope. */
function assertJobInScope(scope: ChatbotScope, jobId: string) {
  if (scope.kind === 'job' && scope.jobId && scope.jobId !== jobId) {
    throw new Error(`Job ${jobId} is outside the active scope.`)
  }
}

/** Build the org-scoped job filter, narrowed to the active scope when needed. */
function jobScopeFilter(orgId: string, scope: ChatbotScope) {
  const base = eq(job.organizationId, orgId)
  if (scope.kind === 'job' && scope.jobId) {
    return and(base, eq(job.id, scope.jobId))
  }
  return base
}

/** Truncate long text to keep the model context manageable. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…[truncated, original length ${text.length} chars]`
}

export function buildChatbotTools(ctx: ChatbotToolContext) {
  return {
    list_jobs: tool({
      description:
        'List jobs in the organization. Use this to find a job ID before drilling into its applications/candidates. ' +
        'Returns id, title, status, location and application count for each job.',
      inputSchema: z.object({
        status: z.enum(['draft', 'open', 'closed', 'archived']).optional()
          .describe('Filter by job status. Omit to list all.'),
        search: z.string().optional()
          .describe('Case-insensitive substring match on job title.'),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ status, search, limit }) => {
        const conditions = [jobScopeFilter(ctx.orgId, ctx.scope)]
        if (status) conditions.push(eq(job.status, status))
        if (search) conditions.push(ilike(job.title, `%${search}%`))

        const rows = await db.query.job.findMany({
          where: and(...conditions),
          orderBy: [desc(job.createdAt)],
          limit,
          columns: {
            id: true, title: true, status: true, location: true, type: true,
            description: true, createdAt: true,
          },
        })
        return rows.map((j) => ({
          id: j.id,
          title: j.title,
          status: j.status,
          location: j.location,
          type: j.type,
          createdAt: j.createdAt,
        }))
      },
    }),

    get_job: tool({
      description:
        'Get full details for a single job, including description, salary, scoring criteria, and pipeline counts.',
      inputSchema: z.object({
        jobId: z.string().min(1),
      }),
      execute: async ({ jobId }) => {
        assertJobInScope(ctx.scope, jobId)
        const j = await db.query.job.findFirst({
          where: and(eq(job.organizationId, ctx.orgId), eq(job.id, jobId)),
        })
        if (!j) throw new Error(`Job ${jobId} not found.`)

        const criteria = await db.query.scoringCriterion.findMany({
          where: and(
            eq(scoringCriterion.organizationId, ctx.orgId),
            eq(scoringCriterion.jobId, jobId),
          ),
          columns: { name: true, description: true, key: true },
        })

        return {
          id: j.id,
          title: j.title,
          status: j.status,
          location: j.location,
          type: j.type,
          experienceLevel: j.experienceLevel,
          remoteStatus: j.remoteStatus,
          salary: j.salaryMin || j.salaryMax
            ? {
                min: j.salaryMin, max: j.salaryMax,
                currency: j.salaryCurrency, unit: j.salaryUnit,
                negotiable: j.salaryNegotiable,
              }
            : null,
          description: truncate(j.description ?? '', 4000),
          scoringCriteria: criteria,
          createdAt: j.createdAt,
        }
      },
    }),

    list_applications: tool({
      description:
        'List applications (candidate ↔ job links). If `jobId` is provided, returns applications for that job only; ' +
        'otherwise returns applications across the entire organization (respecting active scope). ' +
        'Supports optional `dateFrom`/`dateTo` ISO date filters (inclusive) and a `status` filter. ' +
        'Returns candidate name, email, application status, score, jobId, and createdAt — ' +
        'use get_candidate / read_resume for deeper analysis.',
      inputSchema: z.object({
        jobId: z.string().optional().describe('Optional. If omitted, lists across all jobs in the organization.'),
        status: z.enum(['new', 'screening', 'interview', 'offer', 'hired', 'rejected']).optional(),
        dateFrom: z.string().optional().describe('ISO date/datetime — include only applications created on or after this moment.'),
        dateTo: z.string().optional().describe('ISO date/datetime — include only applications created on or before this moment.'),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      execute: async ({ jobId, status, dateFrom, dateTo, limit }) => {
        const conditions = [eq(application.organizationId, ctx.orgId)]
        if (jobId) {
          assertJobInScope(ctx.scope, jobId)
          conditions.push(eq(application.jobId, jobId))
        } else if (ctx.scope.kind === 'job' && ctx.scope.jobId) {
          conditions.push(eq(application.jobId, ctx.scope.jobId))
        }
        if (status) conditions.push(eq(application.status, status))
        if (dateFrom) {
          const d = new Date(dateFrom)
          if (!isNaN(d.getTime())) conditions.push(gte(application.createdAt, d))
        }
        if (dateTo) {
          const d = new Date(dateTo)
          if (!isNaN(d.getTime())) conditions.push(lte(application.createdAt, d))
        }

        // Sprint 6 fix: вытягиваем тотал параллельно с основным запросом.
        const [rows, totalRows] = await Promise.all([
          db.query.application.findMany({
            where: and(...conditions),
            orderBy: [desc(application.score), desc(application.createdAt)],
            limit,
            with: {
              candidate: {
                columns: { id: true, firstName: true, lastName: true, email: true },
              },
              job: {
                columns: { id: true, title: true },
              },
            },
          }),
          db.select({ cnt: count() }).from(application).where(and(...conditions)),
        ])
        const total = Number(totalRows[0]?.cnt ?? rows.length)
        const applications = rows.map((a) => ({
          id: a.id,
          applicationId: a.id,
          candidateId: a.candidateId,
          candidateName: `${a.candidate.firstName} ${a.candidate.lastName}`.trim(),
          candidateEmail: a.candidate.email,
          status: a.status,
          score: a.score,
          jobId: a.job.id,
          jobTitle: a.job.title,
          createdAt: a.createdAt,
        }))
        const truncated = total > applications.length
        return {
          total,
          returned: applications.length,
          truncated,
          applications,
          ...(truncated ? { hint: `${total} applications match. Showing first ${applications.length}. Increase "limit" up to 200 or narrow with status/dateFrom/dateTo if needed.` } : {}),
        }
      },
    }),

    hiring_summary: tool({
      description:
        'Aggregated hiring metrics for the organization (or active job scope). ' +
        'Returns total counts of jobs and applications, plus breakdowns by application status and by job. ' +
        'Supports optional `dateFrom`/`dateTo` ISO date filters for the application createdAt window — ' +
        'use this for questions like "итоги найма за этот месяц", "сколько откликов на этой неделе", "воронка по статусам".',
      inputSchema: z.object({
        dateFrom: z.string().optional().describe('ISO date/datetime — include only applications created on or after this moment.'),
        dateTo: z.string().optional().describe('ISO date/datetime — include only applications created on or before this moment.'),
      }),
      execute: async ({ dateFrom, dateTo }) => {
        const appConds = [eq(application.organizationId, ctx.orgId)]
        if (ctx.scope.kind === 'job' && ctx.scope.jobId) {
          appConds.push(eq(application.jobId, ctx.scope.jobId))
        }
        if (dateFrom) {
          const d = new Date(dateFrom)
          if (!isNaN(d.getTime())) appConds.push(gte(application.createdAt, d))
        }
        if (dateTo) {
          const d = new Date(dateTo)
          if (!isNaN(d.getTime())) appConds.push(lte(application.createdAt, d))
        }

        // Status breakdown
        const byStatus = await db
          .select({ status: application.status, count: count() })
          .from(application)
          .where(and(...appConds))
          .groupBy(application.status)

        // Job breakdown (top 20 by application volume in window)
        const byJob = await db
          .select({
            jobId: application.jobId,
            jobTitle: job.title,
            jobStatus: job.status,
            count: count(application.id),
          })
          .from(application)
          .innerJoin(job, eq(job.id, application.jobId))
          .where(and(...appConds))
          .groupBy(application.jobId, job.title, job.status)
          .orderBy(sql`count(${application.id}) desc`)
          .limit(20)

        // Total jobs in scope (independent of date window)
        const jobConds = [jobScopeFilter(ctx.orgId, ctx.scope)]
        const totalJobsRows = await db
          .select({ status: job.status, count: count() })
          .from(job)
          .where(and(...jobConds))
          .groupBy(job.status)

        const totalApplications = byStatus.reduce((s, r) => s + Number(r.count), 0)
        const totalJobs = totalJobsRows.reduce((s, r) => s + Number(r.count), 0)

        return {
          window: {
            dateFrom: dateFrom ?? null,
            dateTo: dateTo ?? null,
          },
          totals: {
            applications: totalApplications,
            jobs: totalJobs,
          },
          applicationsByStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
          jobsByStatus: totalJobsRows.map((r) => ({ status: r.status, count: Number(r.count) })),
          topJobsByApplications: byJob.map((r) => ({
            jobId: r.jobId,
            jobTitle: r.jobTitle,
            jobStatus: r.jobStatus,
            applications: Number(r.count),
          })),
        }
      },
    }),

    search_candidates: tool({
      description:
        'ПОИСК КАНДИДАТОВ в организации по тексту резюме (full-text), ФИО и email. ' +
        'ОБЯЗАТЕЛЬНО передавай параметр `query` со словом для поиска. ' +
        'Примеры правильных вызовов: ' +
        '{"query":"Python"}, {"query":"React Native"}, {"query":"DevOps Kubernetes Москва"}, {"query":"Иванов"}. ' +
        'Извлекай ключевое слово прямо из запроса пользователя: ' +
        '"кандидаты с опытом на питоне" → query="Python"; ' +
        '"подбери React-разработчиков" → query="React"; ' +
        '"найди Иванова" → query="Иванов". ' +
        'Дополнительно можно фильтровать по статусу отклика (new/screening/interview/offer/hired/rejected). ' +
        'Результаты ранжируются по релевантности резюме (ts_rank). ' +
        'Возвращает { total, returned, truncated, candidates }. Если truncated:true — сообщи пользователю реальное число найденных.',
      inputSchema: z.object({
        query: z.string().min(1).optional().describe(
          'Поисковая фраза. ОБЯЗАТЕЛЬНА если пользователь упомянул навык/должность/имя. ' +
          'Примеры: "Python", "React Native", "DevOps Kubernetes", "Иванов". ' +
          'Можно опустить ТОЛЬКО если задан status или ты находишься в скоупе конкретной вакансии.'
        ),
        status: z.enum(['new', 'screening', 'interview', 'offer', 'hired', 'rejected']).optional().describe(
          'Фильтр по стадии воронки. Оставь пустым если пользователь не уточнил стадию.'
        ),
        limit: z.number().int().min(1).max(20).default(5),
      }),
      execute: async ({ query, status, limit }) => {
        // Диагностика: логируем фактический input от модели.
        console.log('[search_candidates] input:', JSON.stringify({ query, status, limit, scope: ctx.scope }))

        let effectiveQuery = query?.trim() || ''
        const hasStatus = !!status
        const inJobScope = ctx.scope.kind === 'job' && !!ctx.scope.jobId

        // Fallback для слабых моделей (Qwen через Yandex Cloud часто теряет query): извлекаем сами из реплики юзера.
        if (!effectiveQuery && !hasStatus && !inJobScope && ctx.lastUserMessage) {
          const extracted = extractQueryFromUserMessage(ctx.lastUserMessage)
          if (extracted) {
            console.log('[search_candidates] fallback extracted query="%s" from user msg', extracted)
            effectiveQuery = extracted
          }
        }

        const hasQuery = effectiveQuery.length > 0
        if (!hasQuery && !hasStatus && !inJobScope) {
          return {
            error: 'missing_query',
            message: 'Не удалось определить что искать. Укажите навык, должность или имя кандидата.',
          }
        }

        // Дальше работаем с effectiveQuery, а не с исходным query.
        query = effectiveQuery

        // Собираем id-шники по статусу (если указан) — это сужает поисковую выборку.
        let candidateIdsByStatus: Set<string> | null = null
        if (hasStatus) {
          const appConds = [
            eq(application.organizationId, ctx.orgId),
            eq(application.status, status!),
          ]
          if (inJobScope) appConds.push(eq(application.jobId, ctx.scope.jobId!))
          const apps = await db.query.application.findMany({
            where: and(...appConds),
            columns: { candidateId: true },
          })
          candidateIdsByStatus = new Set(apps.map((a) => a.candidateId))
          if (candidateIdsByStatus.size === 0) return []
        }

        // Если есть query — идём через full-text с ранжированием ts_rank по search_tsv.
        // Иначе просто отдаём свежих кандидатов по фильтру.
        type Row = { id: string, firstName: string, lastName: string, email: string, phone: string | null, city: string | null }
        let rows: Row[]

        if (hasQuery) {
          // plainto_tsquery без ошибок на любой ввод (в отличие от to_tsquery).
          // Падаем на ILIKE по ФИО/email как fallback (для коротких подстрок вроде "Ив").
          const q = query!.trim()
          const like = `%${q}%`
          try {
            const result = await db.execute<{
              id: string
              first_name: string
              last_name: string
              email: string
              phone: string | null
              city: string | null
              rank: number
            }>(sql`
              SELECT
                c.id,
                c.first_name,
                c.last_name,
                c.email,
                c.phone,
                c.city,
                GREATEST(
                  COALESCE(ts_rank(c.search_tsv, plainto_tsquery('simple', ${q})), 0),
                  CASE
                    WHEN c.first_name ILIKE ${like} OR c.last_name ILIKE ${like} OR c.email ILIKE ${like}
                      THEN 0.01
                    ELSE 0
                  END
                ) AS rank
              FROM "candidate" c
              WHERE c.organization_id = ${ctx.orgId}
                AND (
                  c.search_tsv @@ plainto_tsquery('simple', ${q})
                  OR c.first_name ILIKE ${like}
                  OR c.last_name ILIKE ${like}
                  OR c.email ILIKE ${like}
                )
              ORDER BY rank DESC, c.created_at DESC
              LIMIT ${limit}
            `)
            const arr = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []
            rows = (arr as Array<{
              id: string, first_name: string, last_name: string, email: string, phone: string | null, city: string | null
            }>).map((r) => ({
              id: r.id,
              firstName: r.first_name,
              lastName: r.last_name,
              email: r.email,
              phone: r.phone,
              city: r.city,
            }))
            console.log('[search_candidates] q=%s rows=%d', q, rows.length)
          }
          catch (err) {
            console.error('[search_candidates] SQL error for q=%s:', q, err instanceof Error ? err.message : err)
            // Fallback на чистый ILIKE через Drizzle — без search_tsv.
            const base = await db.query.candidate.findMany({
              where: and(
                eq(candidate.organizationId, ctx.orgId),
                or(
                  ilike(candidate.firstName, like),
                  ilike(candidate.lastName, like),
                  ilike(candidate.email, like),
                ),
                candidateIdsByStatus ? inArray(candidate.id, Array.from(candidateIdsByStatus)) : undefined,
              ),
              orderBy: [desc(candidate.createdAt)],
              limit,
              columns: { id: true, firstName: true, lastName: true, email: true, phone: true, city: true },
            })
            rows = base
          }
        }
        else {
          // Без query — просто свежие кандидаты в рамках фильтров.
          const base = await db.query.candidate.findMany({
            where: and(
              eq(candidate.organizationId, ctx.orgId),
              candidateIdsByStatus ? inArray(candidate.id, Array.from(candidateIdsByStatus)) : undefined,
            ),
            orderBy: [desc(candidate.createdAt)],
            limit,
            columns: { id: true, firstName: true, lastName: true, email: true, phone: true, city: true },
          })
          rows = base.map((c) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            phone: c.phone,
            city: c.city,
          }))
        }

        // Применяем status-фильтр (если был) пост-фактум из candidateIdsByStatus.
        if (candidateIdsByStatus) {
          rows = rows.filter((c) => candidateIdsByStatus!.has(c.id))
        }

        // Скоуп-фильтрация по вакансии (если ассистент открыт в контексте вакансии) — остаётся как раньше.
        if (inJobScope && rows.length > 0) {
          const apps = await db.query.application.findMany({
            where: and(
              eq(application.organizationId, ctx.orgId),
              eq(application.jobId, ctx.scope.jobId!),
              inArray(application.candidateId, rows.map((c) => c.id)),
            ),
            columns: { candidateId: true },
          })
          const allowed = new Set(apps.map((a) => a.candidateId))
          rows = rows.filter((c) => allowed.has(c.id))
        }

        // Sprint 6 fix «48 вместо 142»: считаем общее число найденных (без limit)
        // чтобы ассистент мог сказать «coвпадений 142, показываю первые 20».
        // Находим тотал по total-rows count: для hasQuery — вторым запросом FTS
        // (без LIMIT), для без-query — COUNT по candidate таблице.
        // Это полный пересчёт без кэша, но использует тот же GIN-индекс — быстро.
        let total = rows.length
        try {
          if (hasQuery) {
            const q = effectiveQuery
            const like = `%${q}%`
            const totalResult = await db.execute<{ cnt: number | string }>(sql`
              SELECT COUNT(*)::int AS cnt
              FROM "candidate" c
              WHERE c.organization_id = ${ctx.orgId}
                AND (
                  c.search_tsv @@ plainto_tsquery('simple', ${q})
                  OR c.first_name ILIKE ${like}
                  OR c.last_name ILIKE ${like}
                  OR c.email ILIKE ${like}
                )
            `)
            const arr = Array.isArray(totalResult) ? totalResult : (totalResult as { rows?: unknown[] }).rows ?? []
            const first = (arr as Array<{ cnt: number | string }>)[0]
            if (first) total = Number(first.cnt)
          }
          else {
            const totalResult = await db
              .select({ cnt: count() })
              .from(candidate)
              .where(
                and(
                  eq(candidate.organizationId, ctx.orgId),
                  candidateIdsByStatus ? inArray(candidate.id, Array.from(candidateIdsByStatus)) : undefined,
                ),
              )
            total = Number(totalResult[0]?.cnt ?? rows.length)
          }
        }
        catch (err) {
          // Если COUNT сломался — фоллбэк на rows.length (лучше недооценка чем падение).
          console.error('[search_candidates] total count failed:', err instanceof Error ? err.message : err)
          total = rows.length
        }

        // Pre-Sprint-6 payload: id, имя, email, phone, city. DeepSeek хорошо работает с этим
        // объёмом и может сразу показать топ-N без дополнительных get_candidate.
        const finalRows = rows.slice(0, limit).map((c) => ({
          id: c.id,
          name: `${c.firstName} ${c.lastName}`.trim(),
          email: c.email,
          phone: c.phone,
          city: c.city,
        }))
        const truncated = total > finalRows.length
        const payload = {
          total,
          returned: finalRows.length,
          truncated,
          candidates: finalRows,
          // Совет для ассистента в self-explanatory форме (не переводим — это в prompt model context):
          ...(truncated ? { hint: `${total} matches total. Showing first ${finalRows.length}. Ask the user to narrow filters or paginate if they need more.` } : {}),
          // Обратная совместимость с chatbotSources.ts и старыми сообщениями в БД.
          count: finalRows.length,
        }
        console.log('[search_candidates] payload bytes=%d count=%d total=%d', JSON.stringify(payload).length, finalRows.length, total)
        return payload
      },
    }),

    get_candidate: tool({
      description:
        'Get full details for one candidate: contact info, all applications (job, status, score), ' +
        'attached documents (resumes, etc.), interviews, and recent comments. ' +
        'Use read_resume to read a specific document.',
      inputSchema: z.object({
        candidateId: z.string().min(1),
      }),
      execute: async ({ candidateId }) => {
        const c = await db.query.candidate.findFirst({
          where: and(
            eq(candidate.organizationId, ctx.orgId),
            eq(candidate.id, candidateId),
          ),
        })
        if (!c) throw new Error(`Candidate ${candidateId} not found.`)

        // Load applications + restrict to scope when set.
        const appConditions = [
          eq(application.organizationId, ctx.orgId),
          eq(application.candidateId, candidateId),
        ]
        if (ctx.scope.kind === 'job' && ctx.scope.jobId) {
          appConditions.push(eq(application.jobId, ctx.scope.jobId))
        }
        const apps = await db.query.application.findMany({
          where: and(...appConditions),
          with: {
            job: { columns: { id: true, title: true, status: true } },
          },
        })

        if (ctx.scope.kind === 'job' && ctx.scope.jobId && apps.length === 0) {
          throw new Error('Candidate is not part of the active job scope.')
        }

        const docs = await db.query.document.findMany({
          where: and(
            eq(document.organizationId, ctx.orgId),
            eq(document.candidateId, candidateId),
          ),
          columns: {
            id: true, type: true, originalFilename: true, mimeType: true, sizeBytes: true,
          },
        })

        const interviews = apps.length === 0
          ? []
          : await db.query.interview.findMany({
              where: and(
                eq(interview.organizationId, ctx.orgId),
                inArray(interview.applicationId, apps.map((a) => a.id)),
              ),
              columns: {
                id: true, title: true, type: true, status: true,
                scheduledAt: true, duration: true, notes: true,
              },
              limit: 20,
            })

        const targetIds = [c.id, ...apps.map((a) => a.id)]
        const recentComments = await db.query.comment.findMany({
          where: and(
            eq(comment.organizationId, ctx.orgId),
            inArray(comment.targetId, targetIds),
          ),
          orderBy: [desc(comment.createdAt)],
          limit: 10,
          columns: { body: true, createdAt: true, targetType: true },
        })

        return {
          id: c.id,
          name: `${c.firstName} ${c.lastName}`.trim(),
          email: c.email,
          phone: c.phone,
          gender: c.gender,
          dateOfBirth: c.dateOfBirth,
          quickNotes: c.quickNotes,
          applications: apps.map((a) => ({
            id: a.id,
            status: a.status,
            score: a.score,
            notes: a.notes,
            jobId: a.job.id,
            jobTitle: a.job.title,
            jobStatus: a.job.status,
            createdAt: a.createdAt,
          })),
          documents: docs,
          interviews,
          recentComments,
        }
      },
    }),

    read_resume: tool({
      description:
        'Read the parsed text content of a candidate\'s document (resume, cover letter, etc.). ' +
        'Use the documentId returned by get_candidate.',
      inputSchema: z.object({
        documentId: z.string().min(1),
      }),
      execute: async ({ documentId }) => {
        const doc = await db.query.document.findFirst({
          where: and(
            eq(document.organizationId, ctx.orgId),
            eq(document.id, documentId),
          ),
        })
        if (!doc) throw new Error(`Document ${documentId} not found.`)

        // Scope check: candidate must be in scope.
        if (ctx.scope.kind === 'job' && ctx.scope.jobId) {
          const inScope = await db.query.application.findFirst({
            where: and(
              eq(application.organizationId, ctx.orgId),
              eq(application.jobId, ctx.scope.jobId),
              eq(application.candidateId, doc.candidateId),
            ),
            columns: { id: true },
          })
          if (!inScope) throw new Error('Document is outside the active job scope.')
        }

        // Sprint 6 fix: resolve candidateName so the Sources panel shows the
        // candidate's name instead of "hh-resume-xxx.json".
        const cand = await db.query.candidate.findFirst({
          where: and(
            eq(candidate.organizationId, ctx.orgId),
            eq(candidate.id, doc.candidateId),
          ),
          columns: { id: true, firstName: true, lastName: true },
        })
        const candidateName = cand
          ? `${cand.firstName} ${cand.lastName}`.trim()
          : null
        const candidateId = cand?.id ?? doc.candidateId

        // Prefer pre-parsed content stored at upload time.
        const parsed = doc.parsedContent as { text?: string } | null
        if (parsed?.text) {
          return {
            documentId: doc.id,
            filename: doc.originalFilename,
            mimeType: doc.mimeType,
            candidateId,
            candidateName,
            text: truncate(parsed.text, CHATBOT_MAX_ATTACHMENT_CHARS),
          }
        }

        // Fall back to live parsing from S3.
        const buf = await downloadFromS3(doc.storageKey)
        const re = await parseDocument(buf, doc.mimeType)
        if (!re?.text) throw new Error('Document could not be parsed.')
        return {
          documentId: doc.id,
          filename: doc.originalFilename,
          mimeType: doc.mimeType,
          candidateId,
          candidateName,
          text: truncate(re.text, CHATBOT_MAX_ATTACHMENT_CHARS),
        }
      },
    }),

    get_application_scores: tool({
      description:
        'Fetch the AI scoring breakdown for a single application: per-criterion scores, ' +
        'rationale, strengths, and concerns. Use this when the user asks "why" a candidate scored as they did.',
      inputSchema: z.object({
        applicationId: z.string().min(1),
      }),
      execute: async ({ applicationId }) => {
        const app = await db.query.application.findFirst({
          where: and(
            eq(application.organizationId, ctx.orgId),
            eq(application.id, applicationId),
          ),
          columns: { id: true, score: true, jobId: true },
        })
        if (!app) throw new Error(`Application ${applicationId} not found.`)
        assertJobInScope(ctx.scope, app.jobId)

        const scores = await db.query.criterionScore.findMany({
          where: and(
            eq(criterionScore.organizationId, ctx.orgId),
            eq(criterionScore.applicationId, applicationId),
          ),
        })

        // Resolve criterion metadata via the job's scoring rubric.
        const rubric = await db.query.scoringCriterion.findMany({
          where: and(
            eq(scoringCriterion.organizationId, ctx.orgId),
            eq(scoringCriterion.jobId, app.jobId),
          ),
          columns: { key: true, name: true, description: true },
        })
        const rubricByKey = new Map(rubric.map((r) => [r.key, r]))

        return {
          applicationId: app.id,
          compositeScore: app.score,
          criteria: scores.map((s) => {
            const meta = rubricByKey.get(s.criterionKey)
            return {
              key: s.criterionKey,
              name: meta?.name ?? s.criterionKey,
              description: meta?.description ?? null,
              score: s.applicantScore,
              maxScore: s.maxScore,
              confidence: s.confidence,
              evidence: s.evidence,
              strengths: s.strengths ?? [],
              gaps: s.gaps ?? [],
            }
          }),
        }
      },
    }),

    list_attachments: tool({
      description:
        'List the files the user uploaded in the current message. Use read_attachment to get their text.',
      inputSchema: z.object({}),
      execute: async () => {
        return ctx.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          textLength: a.textLength,
        }))
      },
    }),

    read_attachment: tool({
      description: 'Read the extracted text of an attachment uploaded by the user in the current message.',
      inputSchema: z.object({
        attachmentId: z.string().min(1),
      }),
      execute: async ({ attachmentId }) => {
        const att = ctx.attachments.find((a) => a.id === attachmentId)
        if (!att) throw new Error(`Attachment ${attachmentId} not found in this message.`)
        return {
          id: att.id,
          filename: att.filename,
          mimeType: att.mimeType,
          text: truncate(att.text, CHATBOT_MAX_ATTACHMENT_CHARS),
        }
      },
    }),
  }
}

export type ChatbotToolSet = ReturnType<typeof buildChatbotTools>
