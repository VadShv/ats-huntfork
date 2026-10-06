import { describe, it, expect } from 'vitest'
import { createBudgetSchema, recalculateSchema, updateBudgetSchema } from '../../server/utils/schemas/aiUsage'
import { csvEscape, previousPeriod, resolveUsageFilters, stripCosts } from '../../server/utils/ai/usage/query'

/** Бюджеты, фильтры и права на суммы — docs/tz-ai-usage.md §7, §9. */
describe('createBudgetSchema', () => {
  it('бюджет организации без scopeKey, пороги сортируются и дедуплицируются', () => {
    const r = createBudgetSchema.parse({ scope: 'org', limitAmount: 5000, thresholds: [100, 50, 80, 50] })
    expect(r.thresholds).toEqual([50, 80, 100])
    expect(r.period).toBe('month')
    expect(r.onExceed).toBe('notify')
  })
  it('бюджет фичи требует известную фичу', () => {
    expect(createBudgetSchema.safeParse({ scope: 'feature', limitAmount: 100 }).success).toBe(false)
    expect(createBudgetSchema.safeParse({ scope: 'feature', scopeKey: 'nope', limitAmount: 100 }).success).toBe(false)
    expect(createBudgetSchema.safeParse({ scope: 'feature', scopeKey: 'screening', limitAmount: 100 }).success).toBe(true)
  })
  it('бюджет операции — только из каталога', () => {
    expect(createBudgetSchema.safeParse({ scope: 'operation', scopeKey: 'scoring.scoreApplication', limitAmount: 10 }).success).toBe(true)
    expect(createBudgetSchema.safeParse({ scope: 'operation', scopeKey: 'x.y', limitAmount: 10 }).success).toBe(false)
  })
  it('лимит должен быть положительным', () => {
    expect(createBudgetSchema.safeParse({ scope: 'org', limitAmount: 0 }).success).toBe(false)
  })
  it('частичное обновление', () => {
    expect(updateBudgetSchema.safeParse({ isActive: false }).success).toBe(true)
  })
  it('пересчёт требует ISO-даты', () => {
    expect(recalculateSchema.safeParse({ from: '2026-10-01T00:00:00Z', to: '2026-10-07T00:00:00Z' }).success).toBe(true)
    expect(recalculateSchema.safeParse({ from: 'вчера', to: 'сегодня' }).success).toBe(false)
  })
})

describe('resolveUsageFilters', () => {
  const now = new Date('2026-10-06T12:00:00Z')
  it('view_own всегда видит только свои вызовы', () => {
    const f = resolveUsageFilters({ userId: 'someone-else' }, { canViewOrg: false, userId: 'me' }, now)
    expect(f.userId).toBe('me')
  })
  it('view_org может фильтровать по сотруднику', () => {
    expect(resolveUsageFilters({ userId: 'u2' }, { canViewOrg: true, userId: 'me' }, now).userId).toBe('u2')
    expect(resolveUsageFilters({}, { canViewOrg: true, userId: 'me' }, now).userId).toBeUndefined()
  })
  it('по умолчанию — 30 дней', () => {
    const f = resolveUsageFilters({}, { canViewOrg: true, userId: 'me' }, now)
    expect(now.getTime() - f.from.getTime()).toBe(30 * 86_400_000)
  })
  it('прошлый месяц — по границам часового пояса', () => {
    const f = resolveUsageFilters({ period: 'prev_month' }, { canViewOrg: true, userId: 'me' }, now)
    expect(f.from.toISOString()).toBe('2026-08-31T21:00:00.000Z')
    expect(f.to.toISOString()).toBe('2026-09-30T21:00:00.000Z')
  })
  it('даты from/to включают последний день', () => {
    const f = resolveUsageFilters({ from: '2026-10-01', to: '2026-10-01' }, { canViewOrg: true, userId: 'me' }, now)
    expect(f.to.getTime() - f.from.getTime()).toBe(86_400_000)
  })
  it('перевёрнутый период — 400', () => {
    expect(() => resolveUsageFilters({ from: '2026-10-05', to: '2026-10-01' }, { canViewOrg: true, userId: 'me' }, now)).toThrow(/период/)
  })
  it('предыдущий период той же длины', () => {
    const f = resolveUsageFilters({ period: '7d' }, { canViewOrg: true, userId: 'me' }, now)
    const p = previousPeriod(f)
    expect(p.to.getTime()).toBe(f.from.getTime())
    expect(f.from.getTime() - p.from.getTime()).toBe(7 * 86_400_000)
  })
})

describe('stripCosts', () => {
  const body = {
    calls: 10, cost: 12.5, costChangePct: 0.2, forecast: 100, lossShare: 0.1, reasoningShare: 0.3, errorShare: 0.05,
    canViewCosts: false, costNote: 'растёт с длиной резюме',
    rows: [{ key: 'a', cost: 1, share: 0.5, avgCostPerTrace: 0.1, inputTokens: 5 }],
    budgets: [{ spent: 1, limit: 2, label: 'x' }],
  }
  it('без view_costs вырезает суммы рекурсивно, оставляет токены и флаги', () => {
    const r = stripCosts(body, false) as Record<string, any>
    expect(r).not.toHaveProperty('cost')
    expect(r).not.toHaveProperty('costChangePct')
    expect(r).not.toHaveProperty('forecast')
    expect(r).not.toHaveProperty('lossShare')
    expect(r.reasoningShare).toBe(0.3)
    expect(r.errorShare).toBe(0.05)
    expect(r.canViewCosts).toBe(false)
    expect(r.costNote).toBe('растёт с длиной резюме')
    expect(r.rows[0]).toEqual({ key: 'a', inputTokens: 5 })
    expect(r.budgets[0]).toEqual({ label: 'x' })
  })
  it('с view_costs возвращает как есть', () => {
    expect(stripCosts(body, true)).toBe(body)
  })
})

describe('csvEscape', () => {
  it('кавычки, разделители и переносы', () => {
    expect(csvEscape('a;b')).toBe('"a;b"')
    expect(csvEscape('скажи "да"')).toBe('"скажи ""да"""')
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(12.5)).toBe('12.5')
  })
  it('защищает от формул', () => {
    expect(csvEscape('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
    expect(csvEscape('@cmd')).toBe("'@cmd")
    expect(csvEscape(-5)).toBe('-5')
  })
})
