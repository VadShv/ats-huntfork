/**
 * Check & award achievements for a recruiter.
 * Called after stage moves, job closures, and on dashboard load.
 */
import { eq, and, sql } from 'drizzle-orm'
import { achievement, userAchievement } from '../../database/schema'
import { ACHIEVEMENT_CATALOG, type AchievementDef } from '../../../shared/achievements-catalog'
import { computeRecruiterMetrics, type RecruiterMetrics } from './metrics'

/** Ensure the catalog is seeded in the DB (idempotent upsert by key). */
export async function ensureCatalogSeeded() {
  for (const def of ACHIEVEMENT_CATALOG) {
    await db.execute(sql`
      INSERT INTO achievement (id, key, name, description, category, tier, icon, metric, threshold, threshold2, points, is_hidden, sort_order)
      VALUES (gen_random_uuid(), ${def.key}, ${def.name}, ${def.description}, ${def.category}, ${def.tier}, ${def.icon}, ${def.metric}, ${def.threshold}, ${def.threshold2 ?? null}, ${def.points}, ${def.isHidden ?? false}, ${def.sortOrder})
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name, description = EXCLUDED.description, tier = EXCLUDED.tier,
        icon = EXCLUDED.icon, points = EXCLUDED.points, threshold = EXCLUDED.threshold,
        threshold2 = EXCLUDED.threshold2, sort_order = EXCLUDED.sort_order
    `)
  }
}

/** Map catalog metric keys (snake_case) to RecruiterMetrics fields (camelCase). */
const METRIC_KEY_MAP: Record<string, keyof RecruiterMetrics> = {
  vacancies_closed: 'vacanciesClosed',
  offers_made: 'offersMade',
  offers_accepted: 'offersAccepted',
  interviews: 'interviews',
  candidates_screened: 'candidatesScreened',
  offer_accept_rate: 'offerAcceptRate',
  activity_streak: 'activityStreak',
  fastest_hire_days: 'fastestHireDays',
  night_activity: 'nightActivity',
  morning_activity: 'morningActivity',
  weekend_activity: 'weekendActivity',
}

/** Check if a metric meets the achievement threshold. */
function meetsThreshold(def: AchievementDef, m: RecruiterMetrics): boolean {
  const key = METRIC_KEY_MAP[def.metric] ?? (def.metric as keyof RecruiterMetrics)
  const val = m[key]
  if (val == null) return false

  // Ratio metric (offer_accept_rate): need min denominator (threshold2)
  if (def.metric === 'offer_accept_rate') {
    return m.offersMade >= (def.threshold2 ?? 10) && (val as number) >= def.threshold
  }

  // "Less than" metric (fastest_hire_days): value must be <= threshold
  if (def.metric === 'fastest_hire_days') {
    return (val as number) > 0 && (val as number) <= def.threshold
  }

  // Default: count >= threshold
  return (val as number) >= def.threshold
}

/** Get current value for an achievement (for progress display). */
function currentValue(def: AchievementDef, m: RecruiterMetrics): number {
  const key = METRIC_KEY_MAP[def.metric] ?? (def.metric as keyof RecruiterMetrics)
  const val = m[key]
  if (val == null) return 0
  if (def.metric === 'fastest_hire_days') return val as number
  if (def.metric === 'offer_accept_rate') return m.offersMade >= (def.threshold2 ?? 10) ? val as number : 0
  return val as number
}

export interface AchievementWithProgress {
  id: string
  key: string
  name: string
  description: string
  category: string
  tier: string
  icon: string
  points: number
  isHidden: boolean
  earned: boolean
  earnedAt: string | null
  currentValue: number
  threshold: number
  progress: number
}

/**
 * Check all achievements for a user, award new ones, and return full list with progress.
 * If awardNew is false, only compute progress without awarding (read-only dashboard).
 */
export async function checkAchievements(
  userId: string,
  orgId: string,
  awardNew = true,
): Promise<{ achievements: AchievementWithProgress[], newlyEarned: AchievementDef[], totalXp: number }> {
  await ensureCatalogSeeded()
  const metrics = await computeRecruiterMetrics(userId, orgId)

  // Get already-earned achievements
  const earned = await db.query.userAchievement.findMany({
    where: and(eq(userAchievement.userId, userId), eq(userAchievement.organizationId, orgId)),
  })
  const earnedMap = new Map(earned.map(e => [e.achievementId, e]))
  const earnedKeys = new Set(earned.map(e => e.achievementId))

  // Get all catalog achievements from DB
  const allAch = await db.query.achievement.findMany({
    orderBy: (t, { asc }) => [asc(t.sortOrder)],
  })
  const achByKey = new Map(allAch.map(a => [a.key, a]))

  const newlyEarned: AchievementDef[] = []
  const result: AchievementWithProgress[] = []

  for (const def of ACHIEVEMENT_CATALOG) {
    const dbAch = achByKey.get(def.key)
    if (!dbAch) continue

    const isEarned = earnedKeys.has(dbAch.id)
    const meets = meetsThreshold(def, metrics)
    const curVal = currentValue(def, metrics)

    // Award new achievement
    if (awardNew && meets && !isEarned) {
      await db.insert(userAchievement).values({
        userId,
        organizationId: orgId,
        achievementId: dbAch.id,
        metadata: { value: curVal },
      }).onConflictDoNothing()
      newlyEarned.push(def)
    }

    const progress = def.metric === 'fastest_hire_days'
      ? (isEarned || meets ? 100 : 0)
      : Math.min(100, Math.round((curVal / def.threshold) * 100))

    result.push({
      id: dbAch.id,
      key: def.key,
      name: def.name,
      description: def.description,
      category: def.category,
      tier: def.tier,
      icon: def.icon,
      points: def.points,
      isHidden: def.isHidden ?? false,
      earned: isEarned || (awardNew && meets),
      earnedAt: earnedMap.get(dbAch.id)?.earnedAt?.toISOString() ?? null,
      currentValue: curVal,
      threshold: def.threshold,
      progress,
    })
  }

  // Total XP = sum of earned achievement points
  const totalXp = result.filter(a => a.earned).reduce((sum, a) => sum + a.points, 0)

  return { achievements: result, newlyEarned, totalXp }
}
