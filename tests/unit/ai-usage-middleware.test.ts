import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateText, streamText, wrapLanguageModel } from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'

const recorded: any[] = []
vi.mock('../../server/utils/ai/usage/writer', () => ({
  recordAiUsage: (ev: unknown) => { recorded.push(ev) },
}))
const assertBackgroundBudget = vi.fn(async () => {})
vi.mock('../../server/utils/ai/usage/budget', () => ({
  assertBackgroundBudget: (...a: unknown[]) => assertBackgroundBudget(...(a as [])),
}))

const { usageMiddleware, classifyAiError, promptStats } = await import('../../server/utils/ai/usage/middleware')
const { withAiOperation } = await import('../../server/utils/ai/usage/context')

const usage = {
  inputTokens: { total: 120, noCache: 100, cacheRead: 20, cacheWrite: 0 },
  outputTokens: { total: 30, text: 25, reasoning: 5 },
}

function model(opts: { fail?: Error } = {}) {
  return wrapLanguageModel({
    model: new MockLanguageModelV3({
      modelId: 'mock-model',
      doGenerate: async () => {
        if (opts.fail) throw opts.fail
        return {
          content: [{ type: 'text', text: 'привет' }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage,
          warnings: [],
        } as any
      },
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: 'при' },
            { type: 'text-delta', id: '1', delta: 'вет' },
            { type: 'text-end', id: '1' },
            { type: 'finish', finishReason: { unified: 'length', raw: 'length' }, usage },
          ] as any,
        }),
      }),
    }),
    middleware: usageMiddleware({ id: 'cfg1', provider: 'openai', model: 'gpt-x' }),
  })
}

beforeEach(() => {
  recorded.length = 0
  assertBackgroundBudget.mockClear()
})

/** Middleware учёта — docs/tz-ai-usage.md §3.2: один вызов модели = одно событие. */
describe('usageMiddleware', () => {
  it('generate: пишет событие с контекстом, токенами и хэшем системного промпта', async () => {
    const text = await withAiOperation(
      { organizationId: 'org1', userId: 'u1', operation: 'scoring.scoreApplication', jobId: 'j1', trigger: 'user', entity: { type: 'application', id: 'a1' } },
      async () => (await generateText({ model: model(), system: 'Ты рекрутер', prompt: 'Оцени' })).text,
    )
    expect(text).toBe('привет')
    expect(recorded).toHaveLength(1)
    const ev = recorded[0]
    expect(ev).toMatchObject({
      organizationId: 'org1', userId: 'u1', operation: 'scoring.scoreApplication', jobId: 'j1',
      entityType: 'application', entityId: 'a1', aiConfigId: 'cfg1', provider: 'openai', model: 'gpt-x',
      mode: 'generate', status: 'ok', stepNo: 1, completionChars: 6, finishReason: 'stop',
    })
    expect(ev.usage).toEqual(usage)
    expect(ev.systemPromptHash).toMatch(/^[0-9a-f]{16,}$/)
    expect(ev.promptChars).toBeGreaterThan(0)
    expect(ev.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('stream: событие после завершения стрима, ttft и finish_reason=length', async () => {
    await withAiOperation({ organizationId: 'org1', operation: 'chatbot.chat', trigger: 'user' }, async () => {
      const r = streamText({ model: model(), prompt: 'Привет' })
      let out = ''
      for await (const d of r.textStream) out += d
      expect(out).toBe('привет')
    })
    await new Promise(r => setTimeout(r, 10))
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ mode: 'stream', status: 'ok', finishReason: 'length', completionChars: 6 })
    expect(recorded[0].ttftMs).not.toBeNull()
  })

  it('ошибка провайдера → событие со статусом error, ошибка пробрасывается', async () => {
    const fail = Object.assign(new Error('Rate limit'), { statusCode: 429 })
    await expect(withAiOperation({ organizationId: 'org1', operation: 'resume.structure' }, () =>
      generateText({ model: model({ fail }), prompt: 'x', maxRetries: 0 }))).rejects.toThrow()
    expect(recorded).toHaveLength(1)
    expect(recorded[0].status).toBe('error')
    expect(recorded[0].usage).toBeNull()
  })

  it('фоновый вызов проверяет бюджет, ручной — нет', async () => {
    await withAiOperation({ organizationId: 'org1', operation: 'scoring.autoScore', trigger: 'background' }, () =>
      generateText({ model: model(), prompt: 'x' }))
    expect(assertBackgroundBudget).toHaveBeenCalledTimes(1)
    await withAiOperation({ organizationId: 'org1', operation: 'scoring.scoreApplication', trigger: 'user' }, () =>
      generateText({ model: model(), prompt: 'x' }))
    expect(assertBackgroundBudget).toHaveBeenCalledTimes(1)
  })

  it('исчерпанный бюджет блокирует фоновый вызов до обращения к модели', async () => {
    assertBackgroundBudget.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Бюджет исчерпан'), { code: 'AI_BUDGET_EXCEEDED' })
    })
    await expect(withAiOperation({ organizationId: 'org1', operation: 'risk.assess', trigger: 'background' }, () =>
      generateText({ model: model(), prompt: 'x', maxRetries: 0 }))).rejects.toThrow(/Бюджет/)
    expect(recorded).toHaveLength(0)
  })

  it('сбой проверки бюджета (не превышение) не мешает вызову', async () => {
    assertBackgroundBudget.mockImplementationOnce(async () => { throw new Error('db down') })
    await withAiOperation({ organizationId: 'org1', operation: 'risk.assess', trigger: 'background' }, () =>
      generateText({ model: model(), prompt: 'x' }))
    expect(recorded).toHaveLength(1)
  })

  it('без контекста событие всё равно пишется (unattributed)', async () => {
    await generateText({ model: model(), prompt: 'x' })
    expect(recorded).toHaveLength(1)
    expect(recorded[0].operation).toBeNull()
    expect(recorded[0].traceId).toBeTruthy()
  })
})

describe('classifyAiError', () => {
  it('таймаут и отмена', () => {
    expect(classifyAiError(Object.assign(new Error('x'), { name: 'AbortError' })).status).toBe('aborted')
    expect(classifyAiError(new Error('Request timed out')).status).toBe('timeout')
    expect(classifyAiError(new Error('boom')).status).toBe('error')
  })
})

describe('promptStats', () => {
  it('считает символы и хэширует только system', () => {
    const a = promptStats([{ role: 'system', content: 'A' }, { role: 'user', content: [{ type: 'text', text: 'привет' }] }])
    const b = promptStats([{ role: 'system', content: 'A' }, { role: 'user', content: [{ type: 'text', text: 'другое' }] }])
    expect(a.chars).toBe(7)
    expect(a.systemHash).toBe(b.systemHash)
    expect(promptStats([{ role: 'user', content: 'x' }]).systemHash).toBeNull()
  })
})
