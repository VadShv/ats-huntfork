/**
 * POST /api/extension/verification/run
 *
 * П4 Sidekick: верификация профиля кандидата через interactive-провайдер
 * организации (фолбэк на analysis; скрининг Qwen не трогаем).
 *
 * Два режима:
 *   stream=true  — SSE: partial-отчёт стримится по мере генерации
 *                  (первая секция видна через секунды, не в конце);
 *   stream=false — прежний блокирующий ответ { ok, report, meta } (фолбэк).
 *
 * Body: { text (текст профиля), title?, sourceUrl?, jobId?, stream? }
 *
 * SSE-события:
 *   data: {"partial": {…}}   — растущий частичный отчёт (троттлинг ≥250 мс)
 *   data: {"done":true, "report":{…}, "meta":{…}, "usage":{…}, "timing":{ttftMs,totalMs}}
 *   data: {"error":"…", "code":"AI_FAILED"}
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { job } from '../../../database/schema'
import { loadAiConfig } from '../../../utils/ai/loadConfig'
import { generateStructuredOutput, streamStructuredOutput, type SupportedProvider } from '../../../utils/ai/provider'
import { prepareInteractiveText } from '../../../utils/ai/textDiet'
import { createRateLimiter } from '../../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 6,
  message: 'Слишком много запусков верификации. Подождите минуту',
})

const bodySchema = z.object({
  text: z.string().min(200, 'Слишком мало текста для анализа').max(80_000),
  title: z.string().max(300).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  jobId: z.string().max(64).optional(),
  /** П4: true — SSE-стрим partial-отчёта; false/нет — блокирующий JSON (фолбэк). */
  stream: z.boolean().optional(),
})

const reportSchema = z.object({
  summary: z.string().describe('Короткая выжимка: общее впечатление о достоверности профиля, 2-4 предложения'),
  timeline: z.array(z.object({
    period: z.string().describe('Период, например «2021–2023» или «март 2022 — н.в.»'),
    place: z.string().describe('Компания или место'),
    role: z.string().describe('Роль/должность'),
    note: z.string().nullish().describe('Примечание: разрыв, пересечение, неточность дат'),
    gap: z.boolean().nullish().describe('true, если перед этим местом есть необъяснённый разрыв стажа'),
  })).max(20).describe('Хронология карьеры по фактам из текста'),
  contradictions: z.array(z.object({
    claim: z.string().describe('Утверждение из профиля'),
    issue: z.string().describe('В чём противоречие или нестыковка'),
    severity: z.enum(['low', 'medium', 'high']),
  })).max(15),
  verifiability: z.array(z.object({
    claim: z.string().describe('Ключевое проверяемое утверждение'),
    status: z.enum(['verifiable', 'partially', 'unverifiable']),
    how: z.string().nullish().describe('Как проверить: вопрос, документ, публичный источник'),
  })).max(15),
  redFlags: z.array(z.object({
    flag: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
    basis: z.string().describe('На каком факте из текста основан флаг'),
  })).max(10),
  questions: z.array(z.string()).max(12).describe('Верификационные вопросы для интервью'),
})

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  let jobContext = ''
  if (body.jobId) {
    const rows = await db
      .select({ title: job.title, description: job.description })
      .from(job)
      .where(and(eq(job.id, body.jobId), eq(job.organizationId, orgId)))
      .limit(1)
    const j = rows[0]
    if (j) {
      jobContext = `\n\n<вакансия>\nНазвание: ${j.title}\n${stripHtml(j.description ?? '').slice(0, 3000)}\n</вакансия>`
    }
  }

  // П5: диета текста — фильтр боилерплейта hh.ru + лимит 16К символов
  const text = prepareInteractiveText(body.text, 16_000)

  const config = await loadAiConfig(orgId, { purpose: 'interactive', preferId: null })
  const providerConfig = {
    provider: config.provider as SupportedProvider,
    model: config.model,
    apiKeyEncrypted: config.apiKeyEncrypted,
    baseUrl: config.baseUrl,
    // П5: отчёту хватает 4К токенов — не даём модели «разгоняться» до лимита конфига
    maxTokens: Math.min(config.maxTokens, 4096),
  }

  const system
    = 'Ты — аналитик верификации кандидатов в ATS Huntfork. Работаешь ТОЛЬКО с фактами '
      + 'из предоставленного текста профиля: не выдумывай события, компании и даты. '
      + 'Твоя задача — построить хронологию карьеры, найти противоречия и разрывы, '
      + 'оценить проверяемость ключевых утверждений, отметить красные флаги и '
      + 'сформулировать верификационные вопросы для интервью. Пиши на русском, кратко и по делу. '
      + 'Не делай финального решения о найме. Если данных мало — верни короткие списки, не заполняй их догадками.'

  const prompt = `Источник: ${body.title ?? ''} ${body.sourceUrl ? `(${body.sourceUrl})` : ''}${jobContext}\n\n<профиль>\n${text}\n</профиль>\n\nПроведи верификационный анализ профиля.`

  const t0 = Date.now()

  // ── Блокирующий путь (фолбэк, прежнее поведение) ──
  if (body.stream !== true) {
    const { object: report, usage, responseModel } = await generateStructuredOutput(providerConfig, {
      system,
      prompt,
      schema: reportSchema,
      schemaName: 'verification_report',
      schemaDescription: 'Верификационный отчёт по профилю кандидата',
    })
    const totalMs = Date.now() - t0

    logApiRequest(event, session, 'extension.verificationRun', {
      textLength: text.length,
      jobId: body.jobId ?? null,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      // П1: длительность и фактическая модель
      total_ms: totalMs,
      ai_provider: config.provider,
      ai_model: config.model,
      response_model: responseModel,
    })

    return {
      ok: true,
      report,
      meta: { provider: config.provider, model: config.model, totalMs, generatedAt: new Date().toISOString() },
    }
  }

  // ── П4: SSE-стрим partial-отчёта ──
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  const res = event.node.res
  const send = (obj: unknown) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
  }

  // Клиент ушёл (закрыл панель / нажал «Стоп») — обрываем генерацию, экономим токены
  const ac = new AbortController()
  event.node.req.on('close', () => {
    if (!res.writableEnded) ac.abort()
  })

  try {
    const result = streamStructuredOutput(providerConfig, {
      system,
      prompt,
      schema: reportSchema,
      schemaName: 'verification_report',
      schemaDescription: 'Верификационный отчёт по профилю кандидата',
      abortSignal: ac.signal,
    })

    let ttftMs: number | null = null
    let lastSentAt = 0
    let pending: unknown = null
    for await (const partial of result.partialObjectStream) {
      if (ttftMs === null) ttftMs = Date.now() - t0
      pending = partial
      // Троттлинг: не чаще одного события в 250 мс, чтобы не заспамить клиент
      const now = Date.now()
      if (now - lastSentAt >= 250) {
        send({ partial })
        pending = null
        lastSentAt = now
      }
    }
    if (pending !== null) send({ partial: pending })

    // Финальный объект валидируется по схеме целиком
    const report = await result.object
    const totalMs = Date.now() - t0
    const usage = await Promise.resolve(result.usage).catch(() => null)

    send({
      done: true,
      report,
      meta: { provider: config.provider, model: config.model, totalMs, generatedAt: new Date().toISOString() },
      usage: usage
        ? { promptTokens: usage.inputTokens ?? 0, completionTokens: usage.outputTokens ?? 0 }
        : undefined,
      timing: { ttftMs, totalMs },
    })
    res.end()

    logApiRequest(event, session, 'extension.verificationRun', {
      textLength: text.length,
      jobId: body.jobId ?? null,
      stream: true,
      promptTokens: usage?.inputTokens ?? null,
      completionTokens: usage?.outputTokens ?? null,
      ttft_ms: ttftMs,
      total_ms: totalMs,
      ai_provider: config.provider,
      ai_model: config.model,
    })
  }
  catch (err: any) {
    if (ac.signal.aborted) {
      // Клиент сам оборвал запрос — тихо закрываем
      if (!res.writableEnded) res.end()
      return
    }
    logWarn('extension.verificationRun.failed', { error_message: err?.message ?? String(err) })
    send({ error: 'Не удалось получить ответ от ИИ. Проверьте настройки провайдера в ATS', code: 'AI_FAILED' })
    res.end()
  }
})
