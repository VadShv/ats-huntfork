/**
 * GET /api/ai-usage/budgets — бюджеты организации с текущим расходом (docs/tz-ai-usage.md §7).
 */
import { and, asc, eq, notInArray } from 'drizzle-orm'
import { aiUsageBudget } from '../../../database/schema'
import { computeBudgetStatus } from '../../../utils/ai/usage/budget'
import { requireAiUsageAccess, userNames } from '../../../utils/ai/usage/query'
import { budgetLabel } from '../../../utils/ai/usage/budget'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event, 'view_costs')
  // Лимиты участников (scope user / member_default) отдаёт GET /api/ai-usage/member-limits.
  const rows = await db.select().from(aiUsageBudget)
    .where(and(eq(aiUsageBudget.organizationId, access.orgId), notInArray(aiUsageBudget.scope, ['user', 'member_default'])))
    .orderBy(asc(aiUsageBudget.createdAt))
  const names = await userNames(rows.filter(r => r.scope === 'user').map(r => r.scopeKey ?? ''))
  const items = await Promise.all(rows.map(async (b) => {
    const st = await computeBudgetStatus(b)
    return {
      id: b.id,
      scope: b.scope,
      scopeKey: b.scopeKey,
      label: budgetLabel(b, b.scope === 'user' && b.scopeKey ? names.get(b.scopeKey) : null),
      period: b.period,
      limitAmount: Number(b.limitAmount),
      currency: b.currency,
      thresholds: b.thresholds,
      onExceed: b.onExceed,
      isActive: b.isActive,
      spent: st.spent,
      pct: st.pct,
      forecast: st.forecast,
      periodStart: st.periodStart.toISOString(),
    }
  }))
  return { items, canManage: access.canManageBudgets, baseCurrency: access.currency.baseCurrency }
})
