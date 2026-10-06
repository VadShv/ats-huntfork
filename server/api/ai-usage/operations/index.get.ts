/**
 * GET /api/ai-usage/operations — каталог ИИ-операций (= Банк промптов) со статистикой
 * за 30 дней (docs/tz-ai-usage.md §10).
 */
import { AI_OPERATIONS, aiFeatureLabel } from '../../../../shared/aiUsage/catalog'
import { operationStats30d } from '../../../utils/ai/usage/breakdown'
import { requireAiUsageAccess, stripCosts } from '../../../utils/ai/usage/query'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const stats = await operationStats30d(access.orgId, access.canViewOrg ? null : access.userId)
  const known = new Set<string>(AI_OPERATIONS.map(o => o.key))
  const items = AI_OPERATIONS.map(o => ({
    key: o.key,
    label: o.label,
    feature: o.feature,
    featureLabel: aiFeatureLabel(o.feature),
    purpose: o.purpose ?? null,
    defaultTrigger: o.defaultTrigger,
    entityType: o.entityType ?? null,
    promptId: o.promptId ?? o.key,
    costNote: o.costNote ?? null,
    usage30d: stats.get(o.key) ?? null,
  }))
  // Операции из журнала, которых нет в каталоге (unattributed, устаревшие ключи).
  const extra = [...stats.entries()].filter(([k]) => !known.has(k)).map(([k, s]) => ({
    key: k, label: k === 'unattributed' ? 'Без атрибуции' : k, feature: 'unattributed', featureLabel: aiFeatureLabel('unattributed'),
    purpose: null, defaultTrigger: null, entityType: null, promptId: null, costNote: null, usage30d: s,
  }))
  return stripCosts({ items: [...items, ...extra] }, access.canViewCosts)
})
