import { describe, it, expect } from 'vitest'
import {
  getAiUsageContext, nextAiStep, normalizeAiRoute, resolveAiRequestActor, setAiRequestResolver, withAiOperation, withAiTrace,
} from '../../server/utils/ai/usage/context'

/** Контекст атрибуции вызовов — docs/tz-ai-usage.md §3.1. */
describe('withAiOperation', () => {
  it('вне контекста — undefined', () => {
    expect(getAiUsageContext()).toBeUndefined()
  })

  it('вложенный контекст наследует и переопределяет поля', () => {
    withAiOperation({ organizationId: 'org1', userId: 'u1', jobId: 'j1', trigger: 'user' }, () => {
      withAiOperation({ operation: 'scoring.scoreApplication', entity: { type: 'application', id: 'a1' } }, () => {
        const c = getAiUsageContext()!
        expect(c.organizationId).toBe('org1')
        expect(c.userId).toBe('u1')
        expect(c.jobId).toBe('j1')
        expect(c.operation).toBe('scoring.scoreApplication')
        expect(c.entity).toEqual({ type: 'application', id: 'a1' })
      })
    })
  })

  it('шаги нумеруются в пределах трейса, вложенные контексты делят счётчик', () => {
    withAiTrace({ operation: 'searchMap.generate' }, () => {
      const outer = getAiUsageContext()!
      expect(nextAiStep(outer)).toBe(1)
      withAiOperation({ operation: 'searchMap.donors' }, () => {
        const inner = getAiUsageContext()!
        expect(inner.traceId).toBe(outer.traceId)
        expect(nextAiStep(inner)).toBe(2)
      })
      expect(nextAiStep(outer)).toBe(3)
    })
  })

  it('withAiTrace начинает новый трейс со своим счётчиком', () => {
    withAiTrace({}, () => {
      const a = getAiUsageContext()!
      nextAiStep(a)
      withAiTrace({}, () => {
        const b = getAiUsageContext()!
        expect(b.traceId).not.toBe(a.traceId)
        expect(nextAiStep(b)).toBe(1)
      })
    })
  })

  it('контекст переживает await', async () => {
    await withAiOperation({ operation: 'resume.structure' }, async () => {
      await new Promise(r => setTimeout(r, 5))
      expect(getAiUsageContext()?.operation).toBe('resume.structure')
    })
  })

  it('без store шаг = 1', () => expect(nextAiStep(undefined)).toBe(1))
})

describe('request resolver', () => {
  it('ошибка резолвера не ломает вызов', () => {
    setAiRequestResolver(() => { throw new Error('no event') })
    expect(resolveAiRequestActor()).toBeNull()
    setAiRequestResolver(() => ({ organizationId: 'o', userId: 'u' }))
    expect(resolveAiRequestActor()).toEqual({ organizationId: 'o', userId: 'u' })
    setAiRequestResolver(null)
    expect(resolveAiRequestActor()).toBeNull()
  })
})

describe('normalizeAiRoute', () => {
  it('заменяет id на :id', () => {
    expect(normalizeAiRoute('/api/applications/3f2b8c1e-1d2a-4c3b-9a8e-1234567890ab/analyze')).toBe('/api/applications/:id/analyze')
    expect(normalizeAiRoute('/api/jobs/123/search-map/generate?x=1')).toBe('/api/jobs/:id/search-map/generate')
    expect(normalizeAiRoute('/api/candidates/Kx9mQ2vT7pLs4nWz8/ai-summary')).toBe('/api/candidates/:id/ai-summary')
  })
  it('не трогает обычные сегменты', () => {
    expect(normalizeAiRoute('/api/extension/search-map')).toBe('/api/extension/search-map')
    expect(normalizeAiRoute('/api/question-bank/questions/generate')).toBe('/api/question-bank/questions/generate')
  })
})
