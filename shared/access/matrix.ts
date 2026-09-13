/**
 * ─────────────────────────────────────────────
 * Role matrix — level ↔ permission mapping (RBAC v2, Sprint 7)
 * ─────────────────────────────────────────────
 *
 * The role editor is a grid of resources × access levels (0..4). This module is
 * the single source that maps a chosen level for a resource to the exact set of
 * permission keys, and back (given a grant set, what level is it). Shared by the
 * UI (render cells) and the server (apply a level → grants), so they never drift.
 *
 * Levels (master plan §8.3):
 *   0 Нет            — no resource:*
 *   1 Просмотр        — resource:read
 *   2 Просмотр + PII  — + read field-sets (contacts/salary)
 *   3 Редактирование  — + create/update
 *   4 Полный          — + delete/export/cancel/…
 */

import { buildPermissionCatalog, type PermissionCatalogEntry } from './catalog'
import { categoryLabelRu, categoryOrder } from './categories'

export type MatrixLevel = 0 | 1 | 2 | 3 | 4

export const MATRIX_LEVELS: { value: MatrixLevel; labelRu: string }[] = [
  { value: 0, labelRu: 'Нет' },
  { value: 1, labelRu: 'Просмотр' },
  { value: 2, labelRu: 'Просмотр + PII' },
  { value: 3, labelRu: 'Редактирование' },
  { value: 4, labelRu: 'Полный' },
]

const WRITE_ACTIONS = new Set(['create', 'update'])
const FULL_ACTIONS = new Set(['delete', 'export', 'cancel'])

/** Does a catalog entry belong to a resource at (or below) a given level? */
function entryLevel(e: PermissionCatalogEntry): MatrixLevel {
  if (e.fieldSet) return 2 // read:contacts / read:salary
  if (e.action === 'read') return 1
  if (WRITE_ACTIONS.has(e.action)) return 3
  if (FULL_ACTIONS.has(e.action)) return 4
  return 4 // any other action counts as "full"
}

export interface ResourceRow {
  resource: string
  category: string
  categoryLabelRu: string
  categoryOrder: number
  /** permission keys grouped by the level at which they are granted */
  byLevel: Record<MatrixLevel, string[]>
  /** all permission keys of the resource */
  allKeys: string[]
  /** whether the resource has PII field-sets (enables the level-2 column) */
  hasPii: boolean
}

/** Build the matrix rows (one per resource) from the permission catalog. */
export function buildMatrixRows(catalog = buildPermissionCatalog()): ResourceRow[] {
  const byResource = new Map<string, PermissionCatalogEntry[]>()
  for (const e of catalog) {
    const list = byResource.get(e.resource) ?? []
    list.push(e)
    byResource.set(e.resource, list)
  }

  const rows: ResourceRow[] = []
  for (const [resource, entries] of byResource) {
    const byLevel: Record<MatrixLevel, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [] }
    for (const e of entries) byLevel[entryLevel(e)].push(e.key)
    const category = entries[0]?.category ?? 'general'
    rows.push({
      resource,
      category,
      categoryLabelRu: categoryLabelRu(category),
      categoryOrder: categoryOrder(category),
      byLevel,
      allKeys: entries.map((e) => e.key),
      hasPii: byLevel[2].length > 0,
    })
  }
  rows.sort((a, b) => a.categoryOrder - b.categoryOrder || a.resource.localeCompare(b.resource))
  return rows
}

/** Permission keys granted for a resource AT a given level (cumulative). */
export function keysForLevel(row: ResourceRow, level: MatrixLevel): string[] {
  const out: string[] = []
  for (let l = 1 as MatrixLevel; l <= level; l = (l + 1) as MatrixLevel) {
    out.push(...row.byLevel[l])
  }
  return out
}

/**
 * Given a set of granted keys, infer the resource's matrix level = the HIGHEST
 * level whose keys are all present. (Fine-tuning may leave partial grants that
 * don't map cleanly; the UI shows the level plus a "custom" hint via cellExact.)
 */
export function levelFromGrants(row: ResourceRow, granted: Set<string>): MatrixLevel {
  let level: MatrixLevel = 0
  for (let l = 1 as MatrixLevel; l <= 4; l = (l + 1) as MatrixLevel) {
    const keys = row.byLevel[l]
    // Level 2 (PII) requires level 1 read too; keysForLevel is cumulative, so
    // check that ALL keys up to l are present.
    const cumulative = keysForLevel(row, l)
    if (cumulative.length > 0 && cumulative.every((k) => granted.has(k))) level = l
    else break
  }
  return level
}

/** True when the granted set for a resource exactly equals a clean level. */
export function isExactLevel(row: ResourceRow, granted: Set<string>): boolean {
  const level = levelFromGrants(row, granted)
  const expected = new Set(keysForLevel(row, level))
  const actualForResource = row.allKeys.filter((k) => granted.has(k))
  return actualForResource.length === expected.size && actualForResource.every((k) => expected.has(k))
}
