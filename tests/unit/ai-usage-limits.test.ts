import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { createBudgetSchema, limitIncreaseRequestSchema, memberLimitSchema } from '../../server/utils/schemas/aiUsage'

/**
 * Персональные лимиты на ИИ — docs/design-profile-and-token-limits.md §3.
 * Схемы, разрешение «личный → по умолчанию», блокировка по триггеру, кэш.
 */

// ── БД-заглушка для limits.ts ────────────────────────────────────
type Budget = { id: string; organizationId: string; scope: string; scopeKey: string | null; period: string; limitAmount: string; currency: string; onExceed: string; isActive: boolean; thresholds: number[] }
const state = {
  budgets: [] as Budget[],
  members: [] as Array<{ organizationId: string; userId: string; role: string; status: string }>,
  usage: new Map<string, { spent: number; calls: number }>(), // userId → расход за любой период
  selectCalls: 0,
}

function selectChain(resolve: () => unknown) {
  const chain: any = {}
  for (const m of ['from', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit']) chain[m] = () => chain
  chain.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(resolve).then(ok, ko)
  return chain
}

vi.stubGlobal('db', {
  select(fields?: Record<string, unknown>) {
    state.selectCalls++
    // Без полей — выборка бюджетов целиком.
    if (!fields) return selectChain(() => state.budgets.filter(b => b.isActive && (b.scope === 'user' || b.scope === 'member_default')))
    // Агрегат расхода по пользователям.
    if ('spent' in fields) {
      return selectChain(() => [...state.usage.entries()].map(([userId, u]) => ({
        userId, spent: u.spent, calls: u.calls, inputTokens: 0, outputTokens: 0, noPriceCalls: 0,
      })))
    }
    // Участники.
    if ('role' in fields && 'name' in fields) {
      return selectChain(() => state.members.filter(m => m.status === 'active').map(m => ({ userId: m.userId, role: m.role, name: m.userId, email: `${m.userId}@x`, image: null })))
    }
    return selectChain(() => [])
  },
  query: {
    member: {
      findFirst: async ({ where }: { where: unknown }) => {
        void where
        return state.members.find(m => m.userId === currentLookupUser) ?? null
      },
    },
  },
})
let currentLookupUser = ''

vi.mock('../../server/utils/ai/usage/pricing', () => ({
  getOrgCurrencySettings: async () => ({ baseCurrency: 'RUB', usdRubRate: 90, rateIsDefault: true, retentionDays: 365, fallbackPricePer1m: null }),
  effectiveFallbackPrice: async () => 100,
}))

const limits = await import('../../server/utils/ai/usage/limits')

function budget(p: Partial<Budget>): Budget {
  return { id: p.id ?? Math.random().toString(36).slice(2), organizationId: 'org', scope: 'member_default', scopeKey: null, period: 'day', limitAmount: '100.00', currency: 'RUB', onExceed: 'block_all', isActive: true, thresholds: [50, 80, 100], ...p }
}

beforeEach(() => {
  state.budgets = []
  state.members = [
    { organizationId: 'org', userId: 'owner', role: 'owner', status: 'active' },
    { organizationId: 'org', userId: 'rec', role: 'member', status: 'active' },
    { organizationId: 'org', userId: 'lead', role: 'admin,member', status: 'active' },
  ]
  state.usage = new Map()
  state.selectCalls = 0
  currentLookupUser = 'rec'
  limits.invalidateUserLimitCache('org')
})

describe('memberLimitSchema', () => {
  it('принимает лимиты по периодам, null — снять, режим по умолчанию block_all', () => {
    const r = memberLimitSchema.parse({ dayLimit: 300, monthLimit: null })
    expect(r).toEqual({ dayLimit: 300, monthLimit: null, onExceed: 'block_all' })
  })
  it('отклоняет отрицательные и нулевые лимиты', () => {
    expect(memberLimitSchema.safeParse({ dayLimit: 0 }).success).toBe(false)
    expect(memberLimitSchema.safeParse({ monthLimit: -5 }).success).toBe(false)
  })
  it('запрос на увеличение — только day/month', () => {
    expect(limitIncreaseRequestSchema.safeParse({ period: 'day' }).success).toBe(true)
    expect(limitIncreaseRequestSchema.safeParse({ period: 'year' }).success).toBe(false)
  })
})

describe('createBudgetSchema: новые scope и режимы', () => {
  it('member_default не требует scopeKey и допускает block_all', () => {
    expect(createBudgetSchema.safeParse({ scope: 'member_default', limitAmount: 500, onExceed: 'block_all' }).success).toBe(true)
  })
  it('block_all недоступен для оргбюджета — он останавливал бы всех', () => {
    expect(createBudgetSchema.safeParse({ scope: 'org', limitAmount: 500, onExceed: 'block_all' }).success).toBe(false)
  })
})

describe('isPrivilegedRole', () => {
  it('owner и admin — привилегированные, в том числе в составных ролях', () => {
    expect(limits.isPrivilegedRole('owner')).toBe(true)
    expect(limits.isPrivilegedRole('admin,member')).toBe(true)
    expect(limits.isPrivilegedRole('member')).toBe(false)
    expect(limits.isPrivilegedRole(null)).toBe(false)
  })
})

describe('resolveUserLimits', () => {
  it('личный лимит важнее лимита по умолчанию', async () => {
    state.budgets = [budget({ id: 'def' }), budget({ id: 'own', scope: 'user', scopeKey: 'rec', limitAmount: '50.00' })]
    const r = await limits.resolveUserLimits('org', 'rec', 'member')
    expect(r.day?.budget.id).toBe('own')
    expect(r.day?.inherited).toBe(false)
    expect(r.month).toBeNull()
  })
  it('без личного — по умолчанию, отмечено как унаследованное', async () => {
    state.budgets = [budget({ id: 'def' })]
    const r = await limits.resolveUserLimits('org', 'rec', 'member')
    expect(r.day?.budget.id).toBe('def')
    expect(r.day?.inherited).toBe(true)
  })
  it('owner/admin не попадают под лимит по умолчанию, но личный на них действует', async () => {
    state.budgets = [budget({ id: 'def' }), budget({ id: 'own', scope: 'user', scopeKey: 'owner', period: 'month' })]
    const r = await limits.resolveUserLimits('org', 'owner', 'owner')
    expect(r.day).toBeNull()
    expect(r.month?.budget.id).toBe('own')
  })
  it('роль подтягивается из БД, если не передана', async () => {
    state.budgets = [budget({ id: 'def' })]
    currentLookupUser = 'lead'
    const r = await limits.resolveUserLimits('org', 'lead')
    expect(r.day).toBeNull()
  })
})

describe('assertUserLimit', () => {
  it('при 100 % и block_all бросает 429 с русским сообщением для любого триггера', async () => {
    state.budgets = [budget({ id: 'def', limitAmount: '100.00' })]
    state.usage.set('rec', { spent: 120, calls: 3 })
    for (const trigger of ['user', 'extension', 'background'] as const) {
      limits.invalidateUserLimitCache('org', 'rec')
      await expect(limits.assertUserLimit('org', 'rec', trigger)).rejects.toMatchObject({
        statusCode: 429,
        data: { code: 'AI_BUDGET_EXCEEDED', kind: 'user_limit', period: 'day' },
      })
    }
    await expect(limits.assertUserLimit('org', 'rec', 'user')).rejects.toThrow(/Дневной лимит ИИ исчерпан: 120 ₽ из 100 ₽\. Сброс .* МСК\./)
  })
  it('system-вызовы не проверяются', async () => {
    state.budgets = [budget({ id: 'def' })]
    state.usage.set('rec', { spent: 999, calls: 1 })
    await expect(limits.assertUserLimit('org', 'rec', 'system')).resolves.toBeUndefined()
  })
  it('режим notify не блокирует; block_background — только фон', async () => {
    state.budgets = [budget({ id: 'def', onExceed: 'notify' })]
    state.usage.set('rec', { spent: 999, calls: 1 })
    await expect(limits.assertUserLimit('org', 'rec', 'user')).resolves.toBeUndefined()

    state.budgets = [budget({ id: 'def2', onExceed: 'block_background' })]
    limits.invalidateUserLimitCache('org')
    await expect(limits.assertUserLimit('org', 'rec', 'user')).resolves.toBeUndefined()
    await expect(limits.assertUserLimit('org', 'rec', 'background')).rejects.toMatchObject({ statusCode: 429 })
  })
  it('ниже 100 % пропускает и кэширует результат на пользователя', async () => {
    state.budgets = [budget({ id: 'def' })]
    state.usage.set('rec', { spent: 80, calls: 1 })
    await limits.assertUserLimit('org', 'rec', 'user')
    const calls = state.selectCalls
    await limits.assertUserLimit('org', 'rec', 'user')
    expect(state.selectCalls).toBe(calls)
    limits.clearUserBlockCache('org')
    await limits.assertUserLimit('org', 'rec', 'user')
    expect(state.selectCalls).toBeGreaterThan(calls)
  })
  it('события без цены оцениваются по резервной цене и считаются в лимите', () => {
    const q = new PgDialect().sqlToQuery(limits.limitCostExpr(100))
    expect(q.sql).toContain('coalesce(sum(coalesce("ai_usage_event"."cost_base", ("ai_usage_event"."input_tokens" + "ai_usage_event"."output_tokens") * 100 / 1000000.0)), 0)::float8')
    const zero = new PgDialect().sqlToQuery(limits.limitCostExpr(-1))
    expect(zero.sql).toContain('* 0 / 1000000.0')
  })
})
