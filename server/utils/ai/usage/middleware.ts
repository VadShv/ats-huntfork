/**
 * Middleware AI SDK для учёта расхода — docs/tz-ai-usage.md §3.2.
 *
 * Встраивается в createLanguageModel / createCloudRuStreamModel, поэтому видит
 * КАЖДЫЙ вызов модели: generateObject/streamText из обёрток provider.ts, прямые
 * generateText/streamText (чат-бот, суфлёр, комментарии), шаги агентов с инструментами.
 * Один вызов модели = одно событие журнала.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { LanguageModelMiddleware } from 'ai'
import { aiFeatureOf, type AiUsageStatus } from '../../../../shared/aiUsage/catalog'
import { assertBackgroundBudget } from './budget'
import { getAiUsageContext, nextAiStep, resolveAiRequestActor } from './context'
import { recordAiUsage, type RawAiUsageEvent } from './writer'

export interface UsageModelConfig {
  id?: string | null
  provider: string
  model: string
}

type CallParams = Parameters<NonNullable<LanguageModelMiddleware['wrapGenerate']>>[0]['params']

/** Длина текста промпта и хэш системной части (без сохранения самого текста). */
export function promptStats(prompt: unknown): { chars: number; systemHash: string | null } {
  if (!Array.isArray(prompt)) return { chars: 0, systemHash: null }
  let chars = 0
  let system = ''
  for (const msg of prompt as Array<{ role?: string; content?: unknown }>) {
    if (typeof msg?.content === 'string') {
      chars += msg.content.length
      if (msg.role === 'system') system += msg.content
      continue
    }
    if (Array.isArray(msg?.content)) {
      for (const part of msg.content as Array<Record<string, unknown>>) {
        if (typeof part?.text === 'string') chars += part.text.length
        else if (part?.type === 'tool-result' && part.output) chars += safeLen(part.output)
        else if (part?.type === 'tool-call' && part.input) chars += safeLen(part.input)
      }
    }
  }
  return {
    chars,
    systemHash: system ? createHash('sha256').update(system).digest('hex').slice(0, 16) : null,
  }
}

function safeLen(v: unknown): number {
  try {
    return typeof v === 'string' ? v.length : JSON.stringify(v).length
  }
  catch {
    return 0
  }
}

function contentChars(content: unknown): number {
  if (!Array.isArray(content)) return 0
  let n = 0
  for (const part of content as Array<Record<string, unknown>>) {
    if (typeof part?.text === 'string') n += part.text.length
    else if (part?.type === 'tool-call' && typeof part.input === 'string') n += part.input.length
  }
  return n
}

/** Классификация ошибки провайдера для разреза «Потери». */
export function classifyAiError(err: unknown): { status: AiUsageStatus; code: string; message: string } {
  const e = err as { name?: string; message?: string; statusCode?: number; cause?: unknown } | null
  const message = String(e?.message ?? err ?? 'unknown').slice(0, 300)
  const lower = message.toLowerCase()
  if (e?.name === 'AbortError' || lower.includes('aborted') || lower.includes('timed out') || lower.includes('timeout')) {
    if (lower.includes('timed out') || lower.includes('timeout')) return { status: 'timeout', code: 'timeout', message }
    return { status: 'aborted', code: 'aborted', message }
  }
  const sc = typeof e?.statusCode === 'number' ? e.statusCode : undefined
  if (sc === 401 || sc === 403) return { status: 'error', code: 'auth', message }
  if (sc === 429) return { status: 'error', code: 'rate_limit', message }
  if (sc !== undefined && sc >= 500) return { status: 'error', code: 'provider_5xx', message }
  if (sc !== undefined && sc >= 400) return { status: 'error', code: 'bad_request', message }
  if (e?.name?.includes('TypeValidation') || e?.name?.includes('NoObjectGenerated') || e?.name?.includes('JSONParse')) {
    return { status: 'error', code: 'schema', message }
  }
  return { status: 'error', code: 'other', message }
}

function finishReasonOf(fr: unknown): string | null {
  if (!fr) return null
  if (typeof fr === 'string') return fr
  if (typeof fr === 'object' && fr && 'unified' in fr) return String((fr as { unified: unknown }).unified)
  return null
}

/** Снимок контекста в момент старта вызова (стрим может завершиться вне ALS-контекста). */
function captureBase(cfg: UsageModelConfig, params: CallParams, mode: 'generate' | 'stream'): Omit<RawAiUsageEvent, 'usage' | 'completionChars' | 'durationMs' | 'ttftMs' | 'status' | 'errorCode' | 'errorMessage' | 'finishReason' | 'responseModel'> {
  const store = getAiUsageContext()
  const actor = resolveAiRequestActor()
  const { chars, systemHash } = promptStats(params?.prompt)
  const id = randomUUID()
  store?.eventCollector?.push(id)
  return {
    id,
    createdAt: new Date(),
    organizationId: store?.organizationId ?? actor?.organizationId ?? null,
    userId: store?.userId ?? actor?.userId ?? null,
    operation: store?.operation ?? null,
    traceId: store?.traceId ?? randomUUID(),
    stepNo: nextAiStep(store),
    trigger: store?.trigger ?? actor?.trigger ?? null,
    source: store?.source ?? actor?.source ?? null,
    jobId: store?.jobId ?? (store?.entity?.type === 'job' ? store.entity.id : null),
    entityType: store?.entity?.type ?? null,
    entityId: store?.entity?.id ?? null,
    purpose: store?.purpose ?? null,
    aiConfigId: cfg.id ?? null,
    provider: cfg.provider,
    model: cfg.model,
    mode,
    promptChars: chars,
    systemPromptHash: systemHash,
  }
}

/**
 * §7.3: фоновые вызовы (автоскоринг, риски, автопилот, ИИ в треде) не уходят к модели,
 * если исчерпан бюджет с блокировкой. Ручные действия не блокируются никогда.
 * Сбой самой проверки не мешает вызову.
 */
async function guardBackground(base: ReturnType<typeof captureBase> | null): Promise<void> {
  if (!base || base.trigger !== 'background' || !base.organizationId) return
  try {
    await assertBackgroundBudget({
      organizationId: base.organizationId,
      feature: aiFeatureOf(base.operation ?? ''),
      operation: base.operation ?? '',
      userId: base.userId,
    })
  }
  catch (err) {
    if ((err as { code?: string })?.code === 'AI_BUDGET_EXCEEDED') throw err
  }
}

function safeRecord(ev: RawAiUsageEvent): void {
  try {
    recordAiUsage(ev)
  }
  catch (err) {
    console.warn('[ai-usage] record failed:', err)
  }
}

export function usageMiddleware(cfg: UsageModelConfig): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate, params }) => {
      const started = Date.now()
      let base: ReturnType<typeof captureBase> | null = null
      try {
        base = captureBase(cfg, params, 'generate')
      }
      catch { /* учёт не должен ломать вызов */ }
      await guardBackground(base)
      try {
        const result = await doGenerate()
        if (base) {
          safeRecord({
            ...base,
            usage: result.usage,
            completionChars: contentChars(result.content),
            durationMs: Date.now() - started,
            ttftMs: null,
            status: 'ok',
            errorCode: null,
            errorMessage: null,
            finishReason: finishReasonOf(result.finishReason),
            responseModel: result.response?.modelId ?? null,
          })
        }
        return result
      }
      catch (err) {
        if (base) {
          const c = classifyAiError(err)
          safeRecord({
            ...base,
            usage: null,
            completionChars: 0,
            durationMs: Date.now() - started,
            ttftMs: null,
            status: c.status,
            errorCode: c.code,
            errorMessage: c.message,
            finishReason: null,
            responseModel: null,
          })
        }
        throw err
      }
    },

    wrapStream: async ({ doStream, params }) => {
      const started = Date.now()
      let base: ReturnType<typeof captureBase> | null = null
      try {
        base = captureBase(cfg, params, 'stream')
      }
      catch { /* учёт не должен ломать вызов */ }
      await guardBackground(base)

      let res: Awaited<ReturnType<typeof doStream>>
      try {
        res = await doStream()
      }
      catch (err) {
        if (base) {
          const c = classifyAiError(err)
          safeRecord({ ...base, usage: null, completionChars: 0, durationMs: Date.now() - started, ttftMs: null, status: c.status, errorCode: c.code, errorMessage: c.message, finishReason: null, responseModel: null })
        }
        throw err
      }
      if (!base) return res

      const b = base
      let ttftMs: number | null = null
      let chars = 0
      let usage: unknown = null
      let finishReason: string | null = null
      let responseModel: string | null = null
      let streamError: unknown = null
      let done = false

      const finalize = (status: AiUsageStatus, err?: unknown) => {
        if (done) return
        done = true
        const c = err ? classifyAiError(err) : null
        safeRecord({
          ...b,
          usage,
          completionChars: chars,
          durationMs: Date.now() - started,
          ttftMs,
          status: c ? c.status : status,
          errorCode: c ? c.code : status === 'aborted' ? 'aborted' : null,
          errorMessage: c ? c.message : null,
          finishReason,
          responseModel,
        })
      }

      const observe = (chunk: Record<string, any>) => {
        switch (chunk?.type) {
          case 'text-delta':
          case 'reasoning-delta':
            if (ttftMs === null) ttftMs = Date.now() - started
            if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') chars += chunk.delta.length
            break
          case 'tool-input-delta':
            if (ttftMs === null) ttftMs = Date.now() - started
            if (typeof chunk.delta === 'string') chars += chunk.delta.length
            break
          case 'response-metadata':
            if (chunk.modelId) responseModel = chunk.modelId
            break
          case 'finish':
            usage = chunk.usage ?? null
            finishReason = finishReasonOf(chunk.finishReason)
            break
          case 'error':
            streamError = chunk.error ?? new Error('stream error')
            break
        }
      }

      const reader = res.stream.getReader()
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const { done: end, value } = await reader.read()
            if (end) {
              if (streamError) finalize('error', streamError)
              else finalize('ok')
              controller.close()
              return
            }
            observe(value as Record<string, any>)
            controller.enqueue(value)
          }
          catch (err) {
            finalize('error', err)
            controller.error(err)
          }
        },
        cancel(reason) {
          // Клиент ушёл / стрим отменён: фиксируем, сколько успели потратить.
          finalize('aborted')
          return reader.cancel(reason)
        },
      })

      params?.abortSignal?.addEventListener?.('abort', () => finalize('aborted'), { once: true })

      return { ...res, stream }
    },
  }
}
