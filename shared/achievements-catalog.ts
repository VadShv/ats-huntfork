/**
 * Achievement catalog — single source of truth for all achievement definitions.
 * Used by the seeder (server/utils/achievements/seed.ts) and the check logic.
 *
 * Metrics (computed in server/utils/achievements/metrics.ts):
 *   vacancies_closed   — jobs closed by the recruiter (activityLog)
 *   offers_made        — applications moved to 'offer' stage by the recruiter
 *   offers_accepted    — applications moved to 'hired' stage by the recruiter
 *   interviews         — applications moved to 'interview' stage by the recruiter
 *   candidates_screened — applications moved to 'screening'+ by the recruiter
 *   offer_accept_rate  — offers_accepted / offers_made (ratio, needs threshold2 = min denominator)
 *   activity_streak    — consecutive days with any activity
 *   fastest_hire_days  — min days from application.createdAt to hire stage move
 */

export interface AchievementDef {
  key: string
  name: string
  description: string
  category: 'vacancies' | 'offers' | 'hires' | 'interviews' | 'speed' | 'streak' | 'special'
  tier: 'bronze' | 'silver' | 'gold' | 'platinum'
  icon: string
  metric: string
  threshold: number
  threshold2?: number
  points: number
  isHidden?: boolean
  sortOrder: number
}

export const ACHIEVEMENT_CATALOG: AchievementDef[] = [
  // ── Vacancies ──
  { key: 'first_close', name: 'Первое закрытие', description: 'Закройте первую вакансию', category: 'vacancies', tier: 'bronze', icon: '🎯', metric: 'vacancies_closed', threshold: 1, points: 10, sortOrder: 1 },
  { key: 'vacancy_5', name: 'Опытный', description: 'Закройте 5 вакансий', category: 'vacancies', tier: 'silver', icon: '📋', metric: 'vacancies_closed', threshold: 5, points: 25, sortOrder: 2 },
  { key: 'vacancy_25', name: 'Ветеран', description: 'Закройте 25 вакансий', category: 'vacancies', tier: 'gold', icon: '🏅', metric: 'vacancies_closed', threshold: 25, points: 50, sortOrder: 3 },
  { key: 'vacancy_100', name: 'Легенда найма', description: 'Закройте 100 вакансий', category: 'vacancies', tier: 'platinum', icon: '👑', metric: 'vacancies_closed', threshold: 100, points: 100, sortOrder: 4 },

  // ── Offers ──
  { key: 'first_offer', name: 'Первый оффер', description: 'Отправьте первый оффер', category: 'offers', tier: 'bronze', icon: '✉️', metric: 'offers_made', threshold: 1, points: 10, sortOrder: 5 },
  { key: 'offer_10', name: 'Переговорщик', description: 'Отправьте 10 офферов', category: 'offers', tier: 'silver', icon: '🤝', metric: 'offers_made', threshold: 10, points: 25, sortOrder: 6 },
  { key: 'offer_50', name: 'Мастер офферов', description: 'Отправьте 50 офферов', category: 'offers', tier: 'gold', icon: '💎', metric: 'offers_made', threshold: 50, points: 50, sortOrder: 7 },
  { key: 'offer_accept_80', name: 'Убедительный', description: '80% офферов приняты (минимум 10 офферов)', category: 'offers', tier: 'gold', icon: '🎯', metric: 'offer_accept_rate', threshold: 80, threshold2: 10, points: 50, sortOrder: 8 },

  // ── Hires ──
  { key: 'first_hire', name: 'Первый найм', description: 'Закройте первого кандидата', category: 'hires', tier: 'bronze', icon: '🎉', metric: 'offers_accepted', threshold: 1, points: 15, sortOrder: 9 },
  { key: 'hire_10', name: 'Талантливый', description: '10 наймов', category: 'hires', tier: 'silver', icon: '🌟', metric: 'offers_accepted', threshold: 10, points: 30, sortOrder: 10 },
  { key: 'hire_50', name: 'Охотник за головами', description: '50 наймов', category: 'hires', tier: 'gold', icon: '🚀', metric: 'offers_accepted', threshold: 50, points: 60, sortOrder: 11 },

  // ── Interviews ──
  { key: 'first_interview', name: 'Первое интервью', description: 'Проведите первое интервью', category: 'interviews', tier: 'bronze', icon: '🗣️', metric: 'interviews', threshold: 1, points: 10, sortOrder: 12 },
  { key: 'interview_25', name: 'Собеседователь', description: '25 интервью', category: 'interviews', tier: 'silver', icon: '📊', metric: 'interviews', threshold: 25, points: 25, sortOrder: 13 },
  { key: 'interview_100', name: 'Профессионал', description: '100 интервью', category: 'interviews', tier: 'gold', icon: '🎙️', metric: 'interviews', threshold: 100, points: 50, sortOrder: 14 },

  // ── Speed ──
  { key: 'fast_hire_7', name: 'Молниеносный', description: 'Найм за 7 дней с момента отклика', category: 'speed', tier: 'silver', icon: '⚡', metric: 'fastest_hire_days', threshold: 7, points: 30, sortOrder: 15 },
  { key: 'fast_hire_3', name: 'Снайпер', description: 'Найм за 3 дня с момента отклика', category: 'speed', tier: 'platinum', icon: '🔥', metric: 'fastest_hire_days', threshold: 3, points: 80, sortOrder: 16 },

  // ── Streak ──
  { key: 'streak_7', name: 'Неделя в строю', description: '7 дней активности подряд', category: 'streak', tier: 'bronze', icon: '📅', metric: 'activity_streak', threshold: 7, points: 15, sortOrder: 17 },
  { key: 'streak_30', name: 'Месяц без пропусков', description: '30 дней активности подряд', category: 'streak', tier: 'gold', icon: '🔥', metric: 'activity_streak', threshold: 30, points: 50, sortOrder: 18 },

  // ── Special (hidden) ──
  { key: 'night_owl', name: 'Ночная смена', description: 'Работа после 22:00', category: 'special', tier: 'bronze', icon: '🦉', metric: 'night_activity', threshold: 1, points: 5, isHidden: true, sortOrder: 19 },
  { key: 'early_bird', name: 'Жаворонок', description: 'Работа до 7:00', category: 'special', tier: 'bronze', icon: '🐓', metric: 'morning_activity', threshold: 1, points: 5, isHidden: true, sortOrder: 20 },
  { key: 'weekend_warrior', name: 'Выходной не отдых', description: 'Работа в выходной день', category: 'special', tier: 'bronze', icon: '💪', metric: 'weekend_activity', threshold: 1, points: 5, isHidden: true, sortOrder: 21 },
]

/** XP thresholds for levels. */
export const LEVELS = [
  { level: 1, title: 'Новичок', minXp: 0 },
  { level: 2, title: 'Ассистент', minXp: 50 },
  { level: 3, title: 'Рекрутер', minXp: 150 },
  { level: 4, title: 'Старший рекрутер', minXp: 350 },
  { level: 5, title: 'Lead', minXp: 650 },
  { level: 6, title: 'Talent Magnet', minXp: 1000 },
]

export function getLevel(xp: number) {
  let current = LEVELS[0]
  let next = LEVELS[1] ?? null
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].minXp) {
      current = LEVELS[i]
      next = LEVELS[i + 1] ?? null
    }
  }
  const progress = next ? Math.min(100, Math.round(((xp - current.minXp) / (next.minXp - current.minXp)) * 100)) : 100
  return { level: current.level, title: current.title, xp, progress, nextLevelXp: next?.minXp ?? null }
}
