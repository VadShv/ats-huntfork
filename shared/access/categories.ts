/**
 * RU labels and display order for permission categories (RBAC v2, Sprint 5 fix).
 * Single source so the matrix UI and per-user overrides editor stay consistent.
 * Category keys come from shared/access/resources.ts (`category` field).
 */

export interface CategoryMeta {
  key: string
  labelRu: string
  order: number
}

// Meaningful order: most-used first (candidates, jobs, applications, interviews),
// then supporting, then service/admin categories.
export const PERMISSION_CATEGORIES: CategoryMeta[] = [
  { key: 'candidates', labelRu: 'Кандидаты', order: 10 },
  { key: 'jobs', labelRu: 'Вакансии', order: 20 },
  { key: 'applications', labelRu: 'Отклики', order: 30 },
  { key: 'interviews', labelRu: 'Интервью', order: 40 },
  { key: 'documents', labelRu: 'Документы', order: 50 },
  { key: 'comments', labelRu: 'Комментарии', order: 60 },
  { key: 'scoring', labelRu: 'Оценка и скоринг', order: 70 },
  { key: 'ai', labelRu: 'AI и промпты', order: 80 },
  { key: 'integrations', labelRu: 'Интеграции', order: 90 },
  { key: 'sourcing', labelRu: 'Источники и трекинг', order: 100 },
  { key: 'templates', labelRu: 'Шаблоны писем', order: 110 },
  { key: 'pipelines', labelRu: 'Воронки', order: 120 },
  { key: 'org-structure', labelRu: 'Оргструктура', order: 130 },
  { key: 'org', labelRu: 'Организация', order: 140 },
  { key: 'members', labelRu: 'Участники и роли', order: 150 },
  { key: 'audit', labelRu: 'Журнал', order: 160 },
  { key: 'general', labelRu: 'Прочее', order: 900 },
]

const _byKey = new Map(PERMISSION_CATEGORIES.map((c) => [c.key, c]))

/** RU label for a category key (falls back to the key itself). */
export function categoryLabelRu(key: string): string {
  return _byKey.get(key)?.labelRu ?? key
}

/** Sort order for a category key (unknown categories sort last, before 'general'). */
export function categoryOrder(key: string): number {
  return _byKey.get(key)?.order ?? 800
}
