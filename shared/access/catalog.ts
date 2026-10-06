/**
 * ─────────────────────────────────────────────
 * Permission catalog — derived from the resource registry (RBAC v2, Sprint 1)
 * ─────────────────────────────────────────────
 *
 * Produces the flat list of permission rows to seed into the `permission`
 * table. Single source: shared/access/resources.ts. Any new resource/action
 * automatically appears here, so it can be granted and matrix-tested.
 */

import { RESOURCES } from './resources'

export interface PermissionCatalogEntry {
  key: string
  resource: string
  action: string
  fieldSet: string | null
  uiLevel: number
  riskLevel: number
  category: string
  labelRu: string
  labelEn: string
}

// Matrix UI level (0..4): Нет / Просмотр / Просмотр+PII / Редактирование / Полный.
function uiLevelFor(action: string, fieldSet: string | null): number {
  if (fieldSet) return 2 // read:contacts / read:salary → "Просмотр + PII"
  switch (action) {
    case 'read':
      return 1
    case 'create':
    case 'update':
      return 3
    case 'delete':
    case 'export':
      return 4
    default:
      return 3
  }
}

function riskLevelFor(resource: string, action: string, fieldSet: string | null, sensitive: boolean): number {
  if (action === 'export' || fieldSet === 'contacts') return 2 // critical: data exfiltration
  if (action === 'delete') return 1
  if (fieldSet === 'salary') return 1
  if (sensitive && action !== 'read') return 1
  return 0
}

const RU: Record<string, string> = {
  read: 'просмотр', create: 'создание', update: 'редактирование',
  delete: 'удаление', export: 'экспорт', cancel: 'отмена',
}
const EN: Record<string, string> = {
  read: 'view', create: 'create', update: 'edit', delete: 'delete',
  export: 'export', cancel: 'cancel',
}

// §I: human labels for granular assistant actions (avoid "assistant: access").
const ASSISTANT_LABELS: Record<string, { ru: string; en: string }> = {
  access: { ru: 'Доступ к ассистенту', en: 'Assistant access' },
  send: { ru: 'Отправка сообщений', en: 'Send messages' },
  scopeOrg: { ru: 'Контекст «вся организация»', en: 'Whole-org context' },
  reasoning: { ru: 'Режим рассуждения', en: 'Reasoning mode' },
  agents: { ru: 'Управление агентами', en: 'Manage agents' },
  selectModel: { ru: 'Выбор AI-модели', en: 'Select AI model' },
  suggest: { ru: 'Суфлёр переписки', en: 'Reply suggester' },
}

// docs/tz-ai-usage.md §9: подписи прав «Расход ИИ».
const AI_USAGE_LABELS: Record<string, { ru: string; en: string }> = {
  view_own: { ru: 'Расход ИИ: свои вызовы', en: 'AI usage: own calls' },
  view_org: { ru: 'Расход ИИ: вся организация', en: 'AI usage: whole org' },
  view_costs: { ru: 'Расход ИИ: суммы в деньгах', en: 'AI usage: costs' },
  manage_budgets: { ru: 'Расход ИИ: бюджеты и настройки', en: 'AI usage: budgets & settings' },
  export: { ru: 'Расход ИИ: экспорт', en: 'AI usage: export' },
  recalculate: { ru: 'Расход ИИ: пересчёт истории', en: 'AI usage: recalculate history' },
}
const LABEL_OVERRIDES: Record<string, Record<string, { ru: string; en: string }>> = {
  assistant: ASSISTANT_LABELS,
  aiUsage: AI_USAGE_LABELS,
}

/** Build the full permission catalog from the resource registry. */
export function buildPermissionCatalog(): PermissionCatalogEntry[] {
  const out: PermissionCatalogEntry[] = []
  const seen = new Set<string>()

  for (const [resource, def] of Object.entries(RESOURCES)) {
    const sensitive = Boolean((def as { sensitive?: boolean }).sensitive)

    // Base actions
    for (const action of def.actions) {
      const key = `${resource}:${action}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        key,
        resource,
        action,
        fieldSet: null,
        uiLevel: uiLevelFor(action, null),
        riskLevel: riskLevelFor(resource, action, null, sensitive),
        category: def.category,
        labelRu: LABEL_OVERRIDES[resource]
          ? (LABEL_OVERRIDES[resource]![action]?.ru ?? `${resource}: ${action}`)
          : `${resource}: ${RU[action] ?? action}`,
        labelEn: LABEL_OVERRIDES[resource]
          ? (LABEL_OVERRIDES[resource]![action]?.en ?? `${resource}: ${action}`)
          : `${resource}: ${EN[action] ?? action}`,
      })
    }

    // Field-set read permissions (PII)
    const fieldSets = (def as { fieldSets?: readonly string[] }).fieldSets ?? []
    for (const fieldSet of fieldSets) {
      const key = `${resource}:read:${fieldSet}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        key,
        resource,
        action: 'read',
        fieldSet,
        uiLevel: uiLevelFor('read', fieldSet),
        riskLevel: riskLevelFor(resource, 'read', fieldSet, sensitive),
        category: def.category,
        labelRu: `${resource}: просмотр (${fieldSet})`,
        labelEn: `${resource}: view (${fieldSet})`,
      })
    }
  }

  return out
}

/** All valid permission keys (for validation / matrix tests). */
export function allPermissionKeys(): Set<string> {
  return new Set(buildPermissionCatalog().map((e) => e.key))
}
