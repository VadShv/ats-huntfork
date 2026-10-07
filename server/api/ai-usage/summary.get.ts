/**
 * GET /api/ai-usage/summary — KPI страницы «Расход ИИ» (docs/tz-ai-usage.md §8.1, блок 1).
 * Расход за период и к прошлому периоду, прогноз месяца, бюджеты, потери, доля размышлений,
 * вызовы без цены и без атрибуции. Без aiUsage:view_costs денежные поля не отдаются.
 */
import { and, desc, eq, gte, notInArray, sql } from 'drizzle-orm'
import { aiUsageAlert, aiUsageBudget, aiUsageEvent } from '../../database/schema'
import { aiFeatureLabel } from '../../../shared/aiUsage/catalog'
import { forecastMonth } from '../../../shared/aiUsage/cost'
import { monthProgress, periodStart } from '../../../shared/aiUsage/period'
import { computeBudgetStatus } from '../../utils/ai/usage/budget'
import {
  AI_USAGE_TIMEZONE, aggColumns, normalizeAgg, previousPeriod, requireAiUsageAccess,
  resolveUsageFilters, stripCosts, usageFilterSchema, usageWhere,
} from '../../utils/ai/usage/query'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const q = await getValidatedQuery(event, usageFilterSchema.parse)
  const f = resolveUsageFilters(q, access)
  const prev = previousPeriod(f)
  const e = aiUsageEvent

  const [[cur], [before], unattributed, topFeature] = await Promise.all([
    db.select(aggColumns()).from(e).where(usageWhere(access.orgId, f)),
    db.select(aggColumns()).from(e).where(usageWhere(access.orgId, prev)),
    db.select({ calls: sql<number>`count(*)::int` }).from(e)
      .where(usageWhere(access.orgId, f, [eq(e.operation, 'unattributed')])),
    db.select({ feature: e.feature, cost: sql<number>`coalesce(sum(${e.costBase}),0)::float8` }).from(e)
      .where(usageWhere(access.orgId, f)).groupBy(e.feature)
      .orderBy(desc(sql`coalesce(sum(${e.costBase}),0)`)).limit(1),
  ])
  const current = normalizeAgg(cur!)
  const previous = normalizeAgg(before!)

  // Прогноз считается по текущему месяцу с теми же фильтрами (кроме периода).
  const now = new Date()
  const monthFrom = periodStart('month', now, AI_USAGE_TIMEZONE)
  const monthF = { ...f, from: monthFrom, to: now }
  const last7F = { ...f, from: new Date(Math.max(monthFrom.getTime(), now.getTime() - 7 * 86_400_000)), to: now }
  const [[m], [l7]] = await Promise.all([
    db.select({ cost: sql<number>`coalesce(sum(${e.costBase}),0)::float8` }).from(e).where(usageWhere(access.orgId, monthF)),
    db.select({ cost: sql<number>`coalesce(sum(${e.costBase}),0)::float8` }).from(e).where(usageWhere(access.orgId, last7F)),
  ])
  const monthSpent = Number(m?.cost ?? 0)
  const forecast = forecastMonth({
    spentMonthToDate: monthSpent,
    spentLast7Days: Number(l7?.cost ?? 0),
    ...monthProgress(now, AI_USAGE_TIMEZONE),
  })

  // Бюджеты (только при праве видеть организацию и суммы).
  let budgets: Array<Record<string, unknown>> = []
  let alerts: Array<Record<string, unknown>> = []
  if (access.canViewOrg && access.canViewCosts) {
    // Персональные лимиты участников (scope user / member_default) — отдельный блок настроек, не оргбюджеты.
    const rows = await db.select().from(aiUsageBudget)
      .where(and(eq(aiUsageBudget.organizationId, access.orgId), eq(aiUsageBudget.isActive, true), notInArray(aiUsageBudget.scope, ['user', 'member_default'])))
    const statuses = await Promise.all(rows.map(b => computeBudgetStatus(b, now)))
    budgets = statuses.map(s => ({
      id: s.budget.id,
      label: s.label,
      scope: s.budget.scope,
      scopeKey: s.budget.scopeKey,
      period: s.budget.period,
      currency: s.budget.currency,
      thresholds: s.budget.thresholds,
      onExceed: s.budget.onExceed,
      spent: s.spent,
      limit: s.limit,
      pct: s.pct,
      forecast: s.forecast,
      exhausted: s.pct >= 100,
    }))
    alerts = await db.select({
      id: aiUsageAlert.id, threshold: aiUsageAlert.threshold, message: aiUsageAlert.message, notifiedAt: aiUsageAlert.notifiedAt,
    }).from(aiUsageAlert)
      .where(and(eq(aiUsageAlert.organizationId, access.orgId), gte(aiUsageAlert.periodStart, monthFrom)))
      .orderBy(desc(aiUsageAlert.notifiedAt)).limit(5)
  }

  const changePct = previous.cost > 0 ? ((current.cost - previous.cost) / previous.cost) * 100 : null
  const callsChangePct = previous.calls > 0 ? ((current.calls - previous.calls) / previous.calls) * 100 : null
  const reasoningShare = current.outputTokens > 0 ? current.reasoningTokens / current.outputTokens : 0
  const top = topFeature[0]

  const body = {
    period: { from: f.from.toISOString(), to: f.to.toISOString() },
    scope: access.canViewOrg ? 'org' as const : 'own' as const,
    currency: access.currency.baseCurrency,
    usdRubRate: access.currency.usdRubRate,
    rateIsDefault: access.currency.rateIsDefault,
    canViewCosts: access.canViewCosts,
    canManageBudgets: access.canManageBudgets,
    canExport: access.canExport,
    calls: current.calls,
    traces: current.traces,
    inputTokens: current.inputTokens,
    cachedInputTokens: current.cachedInputTokens,
    outputTokens: current.outputTokens,
    reasoningTokens: current.reasoningTokens,
    reasoningShare,
    errors: current.errors,
    errorShare: current.calls ? current.errors / current.calls : 0,
    noPriceCalls: current.noPrice,
    estimatedCalls: current.estimated,
    unattributedCalls: Number(unattributed[0]?.calls ?? 0),
    callsChangePct,
    avgDurationMs: current.avgDurationMs,
    // ── деньги ──
    cost: current.cost,
    previousCost: previous.cost,
    costChangePct: changePct,
    avgCostPerTrace: current.traces ? current.cost / current.traces : 0,
    lossCost: current.lossCost,
    lossShare: current.cost > 0 ? current.lossCost / current.cost : 0,
    monthSpent,
    forecast,
    topFeature: top && access.canViewCosts ? { key: top.feature, label: aiFeatureLabel(top.feature), share: current.cost > 0 ? Number(top.cost) / current.cost : 0 } : null,
    budgets,
    alerts,
  }
  return stripCosts(body, access.canViewCosts)
})
