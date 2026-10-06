import { describe, it, expect } from 'vitest'
import { normalizeUsage } from '../../shared/aiUsage/cost'

/** Нормализация usage разных провайдеров — docs/tz-ai-usage.md §3.3. */
describe('normalizeUsage', () => {
  it('LanguageModelV3Usage (middleware): вложенные total/cacheRead/reasoning', () => {
    expect(normalizeUsage({
      inputTokens: { total: 1200, noCache: 200, cacheRead: 1000, cacheWrite: 0 },
      outputTokens: { total: 300, text: 100, reasoning: 200 },
    })).toEqual({ inputTokens: 1200, cachedInputTokens: 1000, cacheWriteTokens: 0, outputTokens: 300, reasoningTokens: 200 })
  })

  it('LanguageModelUsage (generateText): плоские поля + details', () => {
    expect(normalizeUsage({
      inputTokens: 500, outputTokens: 80,
      inputTokenDetails: { cacheReadTokens: 100 }, outputTokenDetails: { reasoningTokens: 20 },
    })).toEqual({ inputTokens: 500, cachedInputTokens: 100, cacheWriteTokens: 0, outputTokens: 80, reasoningTokens: 20 })
  })

  it('устаревшие cachedInputTokens/reasoningTokens', () => {
    const u = normalizeUsage({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 4, reasoningTokens: 3 })
    expect(u?.cachedInputTokens).toBe(4)
    expect(u?.reasoningTokens).toBe(3)
  })

  it('провайдер ничего не вернул → null (будет оценка по символам)', () => {
    expect(normalizeUsage(null)).toBeNull()
    expect(normalizeUsage({})).toBeNull()
    expect(normalizeUsage({ inputTokens: { total: undefined }, outputTokens: { total: undefined } })).toBeNull()
  })

  it('кэш не больше входа, reasoning не больше выхода', () => {
    const u = normalizeUsage({ inputTokens: { total: 10, cacheRead: 50 }, outputTokens: { total: 5, reasoning: 9 } })
    expect(u?.cachedInputTokens).toBe(10)
    expect(u?.reasoningTokens).toBe(5)
  })

  it('мусор → 0, не NaN', () => {
    const u = normalizeUsage({ inputTokens: 'abc', outputTokens: -5 })
    expect(u).toEqual({ inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0 })
  })
})
