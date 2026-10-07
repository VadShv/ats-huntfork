/**
 * GET /api/ai-usage/member-limits — лимит по умолчанию и действующие лимиты всех участников
 * с заполнением за день и месяц (docs/design-profile-and-token-limits.md §3.4).
 * Требует aiUsage:view_costs (суммы) — таблица только для владельца/администратора.
 */
import { defaultLimits, membersLimitStatuses } from '../../../utils/ai/usage/limits'
import { requireAiUsageAccess } from '../../../utils/ai/usage/query'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event, 'view_costs')
  if (!access.canViewOrg) throw createError({ statusCode: 403, statusMessage: 'Нет доступа к расходу организации' })
  const [defaults, statuses] = await Promise.all([defaultLimits(access.orgId), membersLimitStatuses(access.orgId)])
  const def = (b: typeof defaults.day) => b ? { limitAmount: Number(b.limitAmount), currency: b.currency, onExceed: b.onExceed } : null
  return {
    currency: statuses.currency,
    fallbackPricePer1m: access.currency.fallbackPricePer1m,
    canManage: access.canManageBudgets,
    defaults: { day: def(defaults.day), month: def(defaults.month) },
    members: statuses.members
      .sort((a, b) => (b.month.pct ?? -1) - (a.month.pct ?? -1) || a.name.localeCompare(b.name, 'ru'))
      .map(m => ({
        userId: m.userId, name: m.name, email: m.email, image: m.image, role: m.role, privileged: m.privileged,
        day: m.day, month: m.month,
      })),
  }
})
