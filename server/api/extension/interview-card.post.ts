/**
 * POST /api/extension/interview-card
 *
 * П6 Sidekick: генерация карточки интервью (STAR-вопросы по компетенциям)
 * через interactive-провайдер организации (фолбэк на analysis) —
 * вместо локального генератора-мока.
 *
 * Два режима:
 *   stream=true  — SSE: partial-карточка стримится по мере генерации;
 *   stream=false — прежний блокирующий ответ { ok, card, meta } (фолбэк).
 *
 * Body: { text (профиль кандидата), title?, sourceUrl?, jobId?, focus?, stream? }
 *
 * SSE-события:
 *   data: {"partial": {…}}   — растущая частичная карточка (троттлинг ≥250 мс)
 *   data: {"done":true, "card":{…}, "meta":{…}, "usage":{…}, "timing":{ttftMs,totalMs}}
 *   data: {"error":"…", "code":"AI_FAILED"}
 *
 * Сохранение в ATS — заметкой кандидата через существующий /api/extension/note.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { job } from '../../database/schema'
import { loadAiConfig } from '../../utils/ai/loadConfig'
import { generateStructuredOutput, streamStructuredOutput, type SupportedProvider } from '../../utils/ai/provider'
import { prepareInteractiveText } from '../../utils/ai/textDiet'
import { createRateLimiter } from '../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 6,
  message: 'Слишком много генераций. Подождите минуту',
})

const bodySchema = z.object({
  text: z.string().min(200, 'Слишком мало текста профиля').max(80_000),
  title: z.string().max(300).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  jobId: z.string().max(64).optional(),
  focus: z.string().max(500).optional(),
  /** П4: true — SSE-стрим partial-карточки; false/нет — блокирующий JSON (фолбэк). */
  stream: z.boolean().optional(),
})

const cardSchema = z.object({
  role: z.string().describe('Роль, под которую собрана карточка'),
  intro: z.array(z.string()).max(4).describe('Вводные вопросы для разогрева, привязанные к опыту кандидата'),
  blocks: z.array(z.object({
    competency: z.string().describe('Название компетенции'),
    rationale: z.string().describe('Почему эта компетенция важна для данного кандидата/роли'),
    questions: z.array(z.object({
      question: z.string().describe('Вопрос в формате STAR, привязанный к конкретному факту из профиля'),
      listenFor: z.string().describe('Маркеры сильного ответа'),
      redFlag: z.string().nullish().describe('Что в ответе должно насторожить'),
    })).min(1).max(4),
  })).min(2).max(7),
  finalChecks: z.array(z.string()).max(5).describe('Финальные проверки: мотивация, ожидания, ограничения'),
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
    // П5: карточке хватает 4К токенов — не даём модели «разгоняться» до лимита конфига
    maxTokens: Math.min(config.maxTokens, 4096),
  }

  const system
    = 'Ты — методолог структурированных интервью в ATS Huntfork. По тексту профиля кандидата '
      + (jobContext ? 'и вакансии ' : '')
      + 'составь карточку интервью: компетенции, STAR-вопросы, маркеры сильных ответов и красные флаги. '
      + 'Каждый вопрос привязывай к КОНКРЕТНОМУ факту из профиля (проект, компания, технология) — '
      + 'никаких абстрактных вопросов из учебника. Пиши на русском.'
      + (body.focus ? `\n\nОсобый фокус от рекрутера: ${body.focus}` : '')

  const prompt = `Источник: ${body.title ?? ''} ${body.sourceUrl ? `(${body.sourceUrl})` : ''}${jobContext}\n\n<профиль>\n${text}\n</профиль>\n\nСобери карточку интервью.`

  const t0 = Date.now()

  // ── Блокирующий путь (фолбэк, прежнее поведение) ──
  if (body.stream !== true) {
    const { object: card, usage, responseModel } = await generateStructuredOutput(providerConfig, {
      system,
      prompt,
      schema: cardSchema,
      schemaName: 'interview_card',
      schemaDescription: 'Карточка структурированного интервью по компетенциям',
    })
    const totalMs = Date.now() - t0

    logApiRequest(event, session, 'extension.interviewCard', {
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
      card,
      meta: { provider: config.provider, model: config.model, totalMs, generatedAt: new Date().toISOString() },
    }
  }

  // ── П4: SSE-стрим partial-карточки ──
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
      schema: cardSchema,
      schemaName: 'interview_card',
      schemaDescription: 'Карточка структурированного интервью по компетенциям',
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
    const card = await result.object
    const totalMs = Date.now() - t0
    const usage = await Promise.resolve(result.usage).catch(() => null)

    send({
      done: true,
      card,
      meta: { provider: config.provider, model: config.model, totalMs, generatedAt: new Date().toISOString() },
      usage: usage
        ? { promptTokens: usage.inputTokens ?? 0, completionTokens: usage.outputTokens ?? 0 }
        : undefined,
      timing: { ttftMs, totalMs },
    })
    res.end()

    logApiRequest(event, session, 'extension.interviewCard', {
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
    logWarn('extension.interviewCard.failed', { error_message: err?.message ?? String(err) })
    send({ error: 'Не удалось получить ответ от ИИ. Проверьте настройки провайдера в ATS', code: 'AI_FAILED' })
    res.end()
  }
})
