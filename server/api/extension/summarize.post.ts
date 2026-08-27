/**
 * POST /api/extension/summarize
 *
 * S2/S3/S4/S8 Sidekick: стриминговое саммари страницы кандидата через
 * 'analysis'-провайдер организации (скрининговый контур не затрагивается).
 *
 * Режимы:
 *   summary   — выжимка профиля кандидата
 *   fit       — саммари + вывод о соответствии вакансии (требует jobId).
 *               Это САММАРИЗАЦИЯ, не скрининг: официальный AI-скоринг остаётся в ATS
 *   fragment  — саммари выделенного фрагмента
 *   questions — вопросы для интервью по опыту со страницы
 *   translate — перевод содержимого на русский
 *   card      — карточка знаний: навыки / достижения / риски / вопросы
 *   custom    — пользовательская инструкция из библиотеки промптов (S8)
 *
 * Body: { sourceUrl, site?, title?, text (80..80000), mode, jobId?, instruction?, reasoning? }
 *
 * Ответ: text/event-stream
 *   data: {"thinking":"..."}     — фрагмент «размышлений» модели (при reasoning=true)
 *   data: {"delta":"..."}        — очередной фрагмент текста
 *   data: {"done":true, "usage":{...}, "cached":boolean, "timing":{ttftMs,firstTextMs,totalMs}, "model":"..."}
 *   data: {"error":"...", "code":"..."}  — ошибка после старта стрима
 */
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { job } from '../../database/schema'
import { loadAiConfig } from '../../utils/ai/loadConfig'
import { streamTextOutput } from '../../utils/ai/provider'
import { prepareInteractiveText } from '../../utils/ai/textDiet'
import { createRateLimiter } from '../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: 'Слишком много запросов на саммари. Подождите немного',
})

const MODES = ['summary', 'fit', 'fragment', 'questions', 'translate', 'card', 'custom'] as const

const bodySchema = z.object({
  sourceUrl: z.string().url().max(2000),
  site: z.string().max(40).optional(),
  title: z.string().max(300).optional(),
  text: z.string().min(80, 'Слишком мало текста').max(80_000),
  mode: z.enum(MODES),
  jobId: z.string().max(64).optional(),
  instruction: z.string().max(2000).optional(),
  /** Тумблер «Глубокий анализ»: true — thinking включён и стримится, иначе отключается */
  reasoning: z.boolean().optional(),
}).refine(v => v.mode !== 'fit' || !!v.jobId, { message: 'Для режима fit нужен jobId' })
  .refine(v => v.mode !== 'custom' || !!v.instruction, { message: 'Для режима custom нужна instruction' })

// ── Кэш готовых ответов (in-memory, на контейнер) ──────────────────
const CACHE_TTL_MS = 4 * 60 * 60 * 1000
const CACHE_MAX = 200
// П5: + questions — детерминированный режим без пользовательского ввода,
// повторный запрос по той же странице отдаём мгновенно из кэша
const CACHEABLE = new Set(['summary', 'fit', 'card', 'questions'])
const cache = new Map<string, { text: string, at: number }>()

// П5: ключ включает sha1 ПОДГОТОВЛЕННОГО текста, а не его длину:
// две разные страницы одинаковой длины больше не считаются «одинаковыми»
function cacheKey(orgId: string, b: { mode: string, jobId?: string, sourceUrl: string }, preparedText: string) {
  const textHash = createHash('sha1').update(preparedText).digest('hex')
  return createHash('sha1')
    .update(`${orgId}|${b.mode}|${b.jobId ?? ''}|${b.sourceUrl}|${textHash}`)
    .digest('hex')
}

function cacheGet(key: string): string | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.text
}

function cacheSet(key: string, text: string) {
  if (cache.size >= CACHE_MAX) {
    // Простейшая эвикция: удаляем самую старую запись
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(key, { text, at: Date.now() })
}

// ── Промпты ─────────────────────────────────────────────────────────
const BASE_SYSTEM
  = 'Ты ассистент рекрутера в ATS Huntfork. Отвечай на русском языке, кратко и по делу, '
    + 'в Markdown (заголовки ###, списки, **выделение**). Используй ТОЛЬКО факты из предоставленного '
    + 'текста — ничего не выдумывай. Если данных нет, честно скажи об этом.'

function systemFor(mode: string, instruction?: string): string {
  switch (mode) {
    case 'summary':
      return `${BASE_SYSTEM}\nСделай выжимку профиля кандидата: кто это, ключевой стек и навыки, `
        + 'опыт по ролям (компания, срок, суть), сильные стороны, что стоит уточнить. До 250 слов.'
    case 'fit':
      return `${BASE_SYSTEM}\nСделай краткую выжимку профиля (до 120 слов), затем блок "### Соответствие вакансии": `
        + 'вывод одной строкой (Подходит / Скорее да / Скорее нет / Не подходит), совпадения с требованиями, '
        + 'пробелы и риски, 2-3 вопроса для первого контакта. Это предварительная оценка для рекрутера, не финальное решение.'
    case 'fragment':
      return `${BASE_SYSTEM}\nСделай краткую выжимку выделенного фрагмента: суть, ключевые факты, на что обратить внимание рекрутеру. До 150 слов.`
    case 'questions':
      return `${BASE_SYSTEM}\nСоставь 5-8 вопросов для интервью по опыту кандидата из текста: `
        + 'технические по заявленному стеку, поведенческие по достижениям, проверочные по спорным местам. '
        + 'Группируй по темам. Каждый вопрос должен опираться на конкретный факт из текста.'
    case 'translate':
      return 'Ты профессиональный переводчик. Переведи предоставленный текст на русский язык, '
        + 'сохраняя структуру (заголовки, списки) в Markdown. Термины и названия технологий не переводи. '
        + 'Ничего не добавляй от себя.'
    case 'card':
      return `${BASE_SYSTEM}\nСобери карточку знаний кандидата строго из разделов:\n`
        + '### Навыки\n### Достижения (с цифрами, если есть)\n### Риски и пробелы\n'
        + '### Вопросы к интервью\n### Ожидания (зарплата/формат, если указаны)\n'
        + 'Пустые разделы помечай "— нет данных".'
    case 'custom':
      return `${BASE_SYSTEM}\nИнструкция рекрутера: ${instruction}`
    default:
      return BASE_SYSTEM
  }
}

/** Убирает HTML-теги из описания вакансии. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

// П5: пер-режимные лимиты входного текста: коротким задачам — меньше токенов,
// переводу — больше (он работает со всем содержимым)
const MODE_TEXT_LIMIT: Record<string, number> = {
  summary: 10_000,
  questions: 10_000,
  fragment: 10_000,
  fit: 12_000,
  card: 12_000,
  translate: 15_000,
  custom: 15_000,
}

// П5: потолок генерации под режим — саммари не нужны десятки тысяч токенов
const MODE_OUTPUT_TOKENS: Record<string, number> = {
  translate: 4000,
  custom: 2000,
}
const DEFAULT_OUTPUT_TOKENS = 1600

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  // Контекст вакансии (для fit и custom с jobId)
  let jobContext = ''
  if (body.jobId) {
    const rows = await db
      .select({ title: job.title, description: job.description })
      .from(job)
      .where(and(eq(job.id, body.jobId), eq(job.organizationId, orgId)))
      .limit(1)
    const j = rows[0]
    if (!j) {
      throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
    }
    jobContext = `\n\n<вакансия>\nНазвание: ${j.title}\n${stripHtml(j.description ?? '').slice(0, 4000)}\n</вакансия>`
  }

  // П5: диета текста — фильтр боилерплейта hh.ru + пер-режимный лимит
  const text = prepareInteractiveText(body.text, MODE_TEXT_LIMIT[body.mode] ?? 12_000)

  // ── SSE-заголовки ──
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

  // ── Кэш ──
  const t0 = Date.now()
  const key = cacheKey(orgId, body, text)
  if (CACHEABLE.has(body.mode)) {
    const cached = cacheGet(key)
    if (cached) {
      send({ delta: cached })
      send({ done: true, cached: true, timing: { totalMs: Date.now() - t0 } })
      res.end()
      logApiRequest(event, session, 'extension.summarize', { mode: body.mode, cached: true, total_ms: Date.now() - t0 })
      return
    }
  }

  // ── Генерация ──
  try {
    // П2: интерактивный конфиг панели (фолбэк на analysis — поведение не меняется, пока дефолт не назначен)
    const config = await loadAiConfig(orgId, { purpose: 'interactive', preferId: null })
    const label = body.mode === 'fragment' ? 'фрагмент страницы' : 'страница кандидата'
    const prompt = `Источник: ${body.title ?? ''} (${body.sourceUrl})${jobContext}\n\n<${'текст'}>\n${text}\n</${'текст'}>\n\nЭто ${label}. Выполни задачу из системной инструкции.`

    const result = streamTextOutput(config, {
      system: systemFor(body.mode, body.instruction),
      prompt,
      reasoning: body.reasoning === true,
      // П5: потолок генерации под режим — быстрее финал, дешевле запрос
      maxOutputTokens: Math.min(MODE_OUTPUT_TOKENS[body.mode] ?? DEFAULT_OUTPUT_TOKENS, config.maxTokens),
    })

    // П1: телеметрия — первая любая дельта (TTFT) и первый видимый текст
    let ttftMs: number | null = null
    let firstTextMs: number | null = null
    let thinkingChars = 0
    let full = ''
    for await (const part of result.fullStream) {
      if (part.type === 'reasoning-delta') {
        if (ttftMs === null) ttftMs = Date.now() - t0
        thinkingChars += part.text.length
        send({ thinking: part.text })
      }
      else if (part.type === 'text-delta') {
        if (ttftMs === null) ttftMs = Date.now() - t0
        if (firstTextMs === null) firstTextMs = Date.now() - t0
        full += part.text
        send({ delta: part.text })
      }
      else if (part.type === 'error') {
        throw part.error
      }
    }
    const totalMs = Date.now() - t0

    const usage = await result.usage.catch(() => null)
    const response = await Promise.resolve(result.response).catch(() => null)
    if (CACHEABLE.has(body.mode) && full.length > 50) {
      cacheSet(key, full)
    }
    send({
      done: true,
      cached: false,
      usage: usage
        ? { promptTokens: usage.inputTokens ?? 0, completionTokens: usage.outputTokens ?? 0 }
        : undefined,
      timing: { ttftMs, firstTextMs, totalMs },
      model: config.model,
    })
    res.end()

    logApiRequest(event, session, 'extension.summarize', {
      mode: body.mode,
      jobId: body.jobId ?? null,
      site: body.site ?? null,
      chars: text.length,
      promptTokens: usage?.inputTokens ?? null,
      completionTokens: usage?.outputTokens ?? null,
      // П1: длительности и фактическая модель
      ttft_ms: ttftMs,
      first_text_ms: firstTextMs,
      total_ms: totalMs,
      thinking_chars: thinkingChars,
      reasoning: body.reasoning === true,
      ai_provider: config.provider,
      ai_model: config.model,
      response_model: response?.modelId ?? null,
    })
  }
  catch (err: any) {
    logWarn('extension.summarize.failed', { error_message: err?.message ?? String(err) })
    // Стрим уже открыт — отдаём ошибку событием
    send({ error: 'Не удалось получить ответ от ИИ. Проверьте настройки провайдера в ATS', code: 'AI_FAILED' })
    res.end()
  }
})
