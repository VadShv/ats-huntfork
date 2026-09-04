/**
 * Quest catalog — single source of truth. Seeded once at startup.
 * Categories shape behaviour; the daily set always includes >=1 quality quest.
 */

export type QuestType = 'daily' | 'weekly'
export type QuestCategory = 'throughput' | 'responsiveness' | 'hygiene' | 'quality' | 'progression' | 'focus'

export interface QuestDef {
  key: string
  type: QuestType
  category: QuestCategory
  title: string
  description: string
  metric: string
  target: number
  sxpReward: number
  isQuality: boolean // leading-indicator / process quest (balances the daily set)
  weight: number // relative selection weight
}

export const QUEST_CATALOG: QuestDef[] = [
  // ── Daily ──
  { key: 'd_intake', type: 'daily', category: 'throughput', title: 'Разбор входящих', description: 'Продвиньте 5 кандидатов по воронке', metric: 'manual_moves', target: 5, sxpReward: 30, isQuality: false, weight: 10 },
  { key: 'd_fast_response', type: 'daily', category: 'responsiveness', title: 'Быстрый ответ', description: 'Сделайте первый контакт с 3 кандидатами в течение 24 часов', metric: 'fast_first_response', target: 3, sxpReward: 40, isQuality: true, weight: 10 },
  { key: 'd_interview', type: 'daily', category: 'progression', title: 'Интервьюер', description: 'Доведите 1 кандидата до этапа интервью', metric: 'moves_to_interview', target: 1, sxpReward: 40, isQuality: false, weight: 8 },
  { key: 'd_manual_review', type: 'daily', category: 'quality', title: 'Разбор спорных', description: 'Разберите 2 кандидатов, отмеченных ИИ на ручную проверку', metric: 'manual_review_handled', target: 2, sxpReward: 40, isQuality: true, weight: 7 },
  { key: 'd_reject_reason', type: 'daily', category: 'quality', title: 'Причина отказа', description: 'Отклоните 2 кандидатов с указанием причины', metric: 'reject_with_reason', target: 2, sxpReward: 30, isQuality: true, weight: 6 },
  { key: 'd_contact', type: 'daily', category: 'throughput', title: 'Первый контакт', description: 'Начните работу с 3 новыми кандидатами', metric: 'moves_to_contact', target: 3, sxpReward: 30, isQuality: false, weight: 8 },

  // ── Weekly ──
  { key: 'w_closer', type: 'weekly', category: 'progression', title: 'Закрыватель', description: 'Закройте 1 вакансию за неделю', metric: 'vacancies_closed', target: 1, sxpReward: 120, isQuality: false, weight: 10 },
  { key: 'w_finalists', type: 'weekly', category: 'progression', title: 'Финалисты', description: 'Доведите 5 кандидатов до интервью', metric: 'moves_to_interview', target: 5, sxpReward: 100, isQuality: false, weight: 9 },
  { key: 'w_offers', type: 'weekly', category: 'progression', title: 'Оффер-мейкер', description: 'Отправьте 3 оффера', metric: 'moves_to_offer', target: 3, sxpReward: 100, isQuality: false, weight: 8 },
  { key: 'w_flow', type: 'weekly', category: 'throughput', title: 'Поток', description: 'Обработайте 20 кандидатов', metric: 'manual_moves', target: 20, sxpReward: 80, isQuality: false, weight: 8 },
  { key: 'w_sla', type: 'weekly', category: 'responsiveness', title: 'SLA-неделя', description: 'Быстрый первый контакт с 10 кандидатами (в течение 24ч)', metric: 'fast_first_response', target: 10, sxpReward: 130, isQuality: true, weight: 9 },
  { key: 'w_quality_reject', type: 'weekly', category: 'quality', title: 'Честные отказы', description: 'Отклоните 5 кандидатов с указанием причины', metric: 'reject_with_reason', target: 5, sxpReward: 100, isQuality: true, weight: 7 },
]

/** How many active quests per period. */
export const DAILY_QUEST_COUNT = 3
export const WEEKLY_QUEST_COUNT = 4
