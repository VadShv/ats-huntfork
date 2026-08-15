/**
 * POST /api/extension/chat
 *
 * S5 Sidekick: чат со страницей кандидата в контексте вакансии.
 * Стриминговый ответ через 'analysis'-провайдер организации
 * (скрининговый контур и продуктовый AI-ассистент не затрагиваются).
 * История чата эфемерна — живёт в панели расширения, в БД не пишется.
 *
 * Body: {
 *   messages: [{ role: 'user'|'assistant', content }] (1..20, последнее — user),
 *   pageText?: string,   // извлечённый текст страницы (контекст)
 *   sourceUrl?: string,
 *   title?: string,
 *   jobId?: string       // опциональный контекст вакансии
 * }
 *
 * Ответ: text/event-stream — {"delta"} ... {"done", "usage"} | {"error","code"}
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { job } from '../../database/schema'
import { loadAiConfig } from '../../utils/ai/loadConfig'
import { streamTextOutput } from '../../utils/ai/provider'
import { createRateLimiter } from '../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  message: 'Слишком много сообщений. Подождите немного',
})

const bodySchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(4000),
  })).min(1).max(20),
  pageText: z.string().max(80_000).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  title: z.string().max(300).optional(),
  jobId: z.string().max(64).optional(),
}).refine(v => v.messages[v.messages.length - 1]!.role === 'user', {
  message: 'Последнее сообщение должно быть от пользователя',
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
      jobContext = `\n\n<вакансия>\nНазвание: ${j.title}\n${stripHtml(j.description ?? '').slice(0, 4000)}\n</вакансия>`
    }
  }

  const pageText = (body.pageText ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 12_000)

  const system
    = 'Ты ассистент рекрутёра в ATS Huntfork. Отвечай на русском, кратко, в Markdown. '
      + 'Отвечай на вопросы по предоставленному контексту страницы кандидата'
      + (jobContext ? ' и вакансии' : '')
      + '. Используй ТОЛЬКО факты из контекста — если ответа в нём нет, скажи прямо. '
      + 'Не давай финальных решений о найме — только наблюдения и факты.'
      + (pageText
        ? `\n\n<страница${body.title ? ` title="${body.title.replace(/"/g, '\'')}"` : ''}>\n${pageText}\n</страница>`
        : '')
      + jobContext

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

  try {
    const config = await loadAiConfig(orgId, { purpose: 'analysis', preferId: null })
    const result = streamTextOutput(config, { system, messages: body.messages })

    for await (const delta of result.textStream) {
      send({ delta })
    }
    const usage = await result.usage.catch(() => null)
    send({
      done: true,
      usage: usage
        ? { promptTokens: usage.inputTokens ?? 0, completionTokens: usage.outputTokens ?? 0 }
        : undefined,
    })
    res.end()

    logApiRequest(event, session, 'extension.chat', {
      turns: body.messages.length,
      jobId: body.jobId ?? null,
      pageChars: pageText.length,
      promptTokens: usage?.inputTokens ?? null,
      completionTokens: usage?.outputTokens ?? null,
    })
  }
  catch (err: any) {
    logWarn('extension.chat.failed', { error_message: err?.message ?? String(err) })
    send({ error: 'Не удалось получить ответ от ИИ. Проверьте настройки провайдера в ATS', code: 'AI_FAILED' })
    res.end()
  }
})
