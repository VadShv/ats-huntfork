/**
 * GET /api/me/ai-limits — мои лимиты на ИИ и их заполнение (личный кабинет,
 * docs/design-profile-and-token-limits.md §2.2). Суммы — только при aiUsage:view_costs,
 * иначе проценты и токены.
 */
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { aiUsageEvent } from '../../../database/schema'
import { member } from '../../../database/schema/auth'
import { aiOperationLabel } from '../../../../shared/aiUsage/catalog'
import { userLimitStatuses, type UserLimitStatus } from '../../../utils/ai/usage/limits'
import { requireAiUsageAccess, stripCosts } from '../../../utils/ai/usage/query'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const m = await db.query.member.findFirst({ where: and(eq(member.organizationId, access.orgId), eq(member.userId, access.userId)) })
  const st = await userLimitStatuses(access.orgId, access.userId, m?.role ?? null)

  // Топ операций за месяц — чтобы человек понимал, на что уходит лимит.
  const from = new Date(st.month.periodStart)
  const to = new Date(st.month.resetAt)
  const top = await db.select({
    operation: aiUsageEvent.operation,
    calls: sql<number>`count(*)::int`,
    tokens: sql<number>`coalesce(sum(${aiUsageEvent.inputTokens} + ${aiUsageEvent.outputTokens}), 0)::bigint`,
    cost: sql<number>`coalesce(sum(${aiUsageEvent.costBase}), 0)::float8`,
  }).from(aiUsageEvent)
    .where(and(eq(aiUsageEvent.organizationId, access.orgId), eq(aiUsageEvent.userId, access.userId), gte(aiUsageEvent.createdAt, from), lt(aiUsageEvent.createdAt, to)))
    .groupBy(aiUsageEvent.operation)
    .orderBy(desc(sql`coalesce(sum(${aiUsageEvent.costBase}), 0)`), desc(sql`count(*)`))
    .limit(3)

  const present = (s: UserLimitStatus) => ({
    period: s.period,
    enabled: s.limit !== null,
    inherited: s.inherited,
    onExceed: s.onExceed,
    blocked: s.blocked,
    pct: s.pct,
    resetAt: s.resetAt,
    calls: s.calls,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    // деньги — вырезаются stripCosts без view_costs
    limit: s.limit,
    spent: s.spent,
  })

  return stripCosts({
    currency: access.currency.baseCurrency,
    canViewCosts: access.canViewCosts,
    day: present(st.day),
    month: present(st.month),
    topOperations: top.map(t => ({
      key: t.operation ?? 'unattributed',
      label: aiOperationLabel(t.operation ?? 'unattributed'),
      calls: Number(t.calls), tokens: Number(t.tokens), cost: Number(t.cost),
    })),
  }, access.canViewCosts)
})
