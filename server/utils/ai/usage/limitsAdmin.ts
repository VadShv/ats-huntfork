/**
 * Запись лимитов участников (docs/design-profile-and-token-limits.md §3.4):
 * один активный лимит на (организация, scope, участник, период). Старые активные строки
 * деактивируются, а не удаляются — на них ссылаются ai_usage_alert и история аудита.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { aiUsageBudget } from '../../../database/schema'
import { checkBudgets, invalidateBudgetCache } from './budget'
import type { LimitPeriod } from './limits'

export interface LimitWrite {
  dayLimit?: number | null
  monthLimit?: number | null
  onExceed: 'notify' | 'block_all'
}

/**
 * Применить лимиты: undefined — не трогать период, null — снять, число — поставить.
 * scope 'member_default' (scopeKey = null) или 'user' (scopeKey = userId).
 */
export async function writeMemberLimits(opts: {
  orgId: string
  actorId: string
  scope: 'user' | 'member_default'
  scopeKey: string | null
  currency: string
  write: LimitWrite
}): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }> {
  const { orgId, actorId, scope, scopeKey, currency, write } = opts
  const periods: Array<[LimitPeriod, number | null | undefined]> = [['day', write.dayLimit], ['month', write.monthLimit]]
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  await db.transaction(async (tx) => {
    for (const [period, value] of periods) {
      if (value === undefined) continue
      const where = and(
        eq(aiUsageBudget.organizationId, orgId),
        eq(aiUsageBudget.scope, scope),
        scopeKey === null ? eq(aiUsageBudget.scope, scope) : eq(aiUsageBudget.scopeKey, scopeKey),
        eq(aiUsageBudget.period, period),
        eq(aiUsageBudget.isActive, true),
      )
      const existing = await tx.select().from(aiUsageBudget).where(where)
      before[period] = existing[0] ? { limitAmount: Number(existing[0].limitAmount), onExceed: existing[0].onExceed } : null
      if (existing.length) {
        await tx.update(aiUsageBudget).set({ isActive: false, updatedAt: new Date() })
          .where(inArray(aiUsageBudget.id, existing.map(e => e.id)))
      }
      if (value === null) {
        after[period] = null
        continue
      }
      await tx.insert(aiUsageBudget).values({
        organizationId: orgId,
        scope,
        scopeKey,
        period,
        limitAmount: value.toFixed(2),
        currency,
        thresholds: [50, 80, 100],
        onExceed: write.onExceed,
        isActive: true,
        createdById: actorId,
      })
      after[period] = { limitAmount: value, onExceed: write.onExceed }
    }
  })
  invalidateBudgetCache(orgId)
  await recordActivity({
    organizationId: orgId,
    actorId,
    action: 'updated',
    resourceType: scope === 'user' ? 'ai_user_limit' : 'ai_member_default_limit',
    resourceId: scopeKey ?? orgId,
    before,
    after,
  })
  // Лимит мог быть уже превышен — пороги и уведомления сразу.
  checkBudgets(orgId).catch(() => {})
  return { before, after }
}
