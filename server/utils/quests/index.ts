/**
 * Quest engine: seed catalog, lazy-assign daily/weekly quests, compute progress,
 * and claim rewards (bonus SXP → HuntPass season).
 */
import { and, eq, sql } from 'drizzle-orm'
import { questTemplate, userQuest, userSeasonProgress } from '../../database/schema'
import { QUEST_CATALOG, DAILY_QUEST_COUNT, WEEKLY_QUEST_COUNT, type QuestType } from '../../../shared/quests-catalog'
import { computeMetric } from '../gamification/metrics-registry'
import { dailyPeriod, weeklyPeriod, type Period } from './period'
import { getOrCreateCurrentSeason } from '../huntpass/season'

/** Seed quest_template from the catalog (idempotent). */
export async function ensureQuestCatalogSeeded() {
  for (const q of QUEST_CATALOG) {
    await db.execute(sql`
      INSERT INTO quest_template (id, key, type, category, title, description, metric, target, sxp_reward, is_quality, weight, is_active)
      VALUES (gen_random_uuid(), ${q.key}, ${q.type}, ${q.category}, ${q.title}, ${q.description}, ${q.metric}, ${q.target}, ${q.sxpReward}, ${q.isQuality}, ${q.weight}, true)
      ON CONFLICT (key) DO UPDATE SET
        title = EXCLUDED.title, description = EXCLUDED.description, category = EXCLUDED.category,
        metric = EXCLUDED.metric, target = EXCLUDED.target, sxp_reward = EXCLUDED.sxp_reward,
        is_quality = EXCLUDED.is_quality, weight = EXCLUDED.weight
    `)
  }
}

/** Weighted random pick of `count` quests of a type, guaranteeing >=1 quality. */
function pickQuests(type: QuestType, count: number) {
  const pool = QUEST_CATALOG.filter(q => q.type === type)
  const chosen: typeof pool = []
  const remaining = [...pool]

  // Guarantee at least one quality quest.
  const qualityPool = remaining.filter(q => q.isQuality)
  if (qualityPool.length) {
    const q = weightedPick(qualityPool)
    chosen.push(q)
    remaining.splice(remaining.indexOf(q), 1)
  }
  while (chosen.length < count && remaining.length) {
    const q = weightedPick(remaining)
    chosen.push(q)
    remaining.splice(remaining.indexOf(q), 1)
  }
  return chosen
}

function weightedPick<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0)
  let r = Math.random() * total
  for (const it of items) {
    r -= it.weight
    if (r <= 0) return it
  }
  return items[items.length - 1]
}

/** Ensure quests are assigned for a period; return the assigned template keys. */
async function ensureAssigned(userId: string, orgId: string, type: QuestType, period: Period, count: number) {
  const existing = await db.query.userQuest.findMany({
    where: and(
      eq(userQuest.organizationId, orgId),
      eq(userQuest.userId, userId),
      eq(userQuest.periodKey, period.key),
    ),
    with: { template: true },
  })
  const existingForType = existing.filter(e => e.template?.type === type)
  if (existingForType.length >= count) return existing

  // Assign fresh set for this period/type.
  const templates = await db.query.questTemplate.findMany({ where: eq(questTemplate.isActive, true) })
  const byKey = new Map(templates.map(t => [t.key, t]))
  const picks = pickQuests(type, count)
  for (const p of picks) {
    const tpl = byKey.get(p.key)
    if (!tpl) continue
    await db.insert(userQuest).values({
      userId, organizationId: orgId, questTemplateId: tpl.id, periodKey: period.key,
    }).onConflictDoNothing()
  }
  return db.query.userQuest.findMany({
    where: and(
      eq(userQuest.organizationId, orgId),
      eq(userQuest.userId, userId),
      eq(userQuest.periodKey, period.key),
    ),
    with: { template: true },
  })
}

export interface QuestView {
  id: string
  key: string
  type: string
  category: string
  title: string
  description: string
  metric: string
  target: number
  sxpReward: number
  isQuality: boolean
  progress: number
  completed: boolean
  claimed: boolean
  periodKey: string
}

/** Get daily + weekly quests with live progress. */
export async function getUserQuests(userId: string, orgId: string): Promise<QuestView[]> {
  const now = new Date()
  const daily = dailyPeriod(now)
  const weekly = weeklyPeriod(now)

  const dailyRows = await ensureAssigned(userId, orgId, 'daily', daily, DAILY_QUEST_COUNT)
  const weeklyRows = await ensureAssigned(userId, orgId, 'weekly', weekly, WEEKLY_QUEST_COUNT)

  const all = [...dailyRows, ...weeklyRows].filter(r => r.template)
  const views: QuestView[] = []
  for (const r of all) {
    const t = r.template!
    const period = t.type === 'daily' ? daily : weekly
    if (r.periodKey !== period.key) continue // stale row from another period
    const raw = await computeMetric(t.metric, userId, orgId, period.start.toISOString(), period.end.toISOString())
    const progress = Math.min(t.target, raw)
    const completed = progress >= t.target
    // Auto-mark completed status
    if (completed && r.status === 'active') {
      await db.update(userQuest).set({ status: 'completed' }).where(eq(userQuest.id, r.id))
    }
    views.push({
      id: r.id, key: t.key, type: t.type, category: t.category, title: t.title, description: t.description,
      metric: t.metric, target: t.target, sxpReward: t.sxpReward, isQuality: t.isQuality,
      progress, completed, claimed: r.status === 'claimed', periodKey: r.periodKey,
    })
  }
  return views
}

/** Claim a completed quest → award bonus SXP to the current season. */
export async function claimQuest(userId: string, orgId: string, userQuestId: string) {
  const row = await db.query.userQuest.findFirst({
    where: and(eq(userQuest.id, userQuestId), eq(userQuest.organizationId, orgId), eq(userQuest.userId, userId)),
    with: { template: true },
  })
  if (!row || !row.template) throw createError({ statusCode: 404, statusMessage: 'Квест не найден' })
  if (row.status === 'claimed') throw createError({ statusCode: 409, statusMessage: 'Награда уже получена' })

  const period = row.template.type === 'daily' ? dailyPeriod() : weeklyPeriod()
  if (row.periodKey !== period.key) throw createError({ statusCode: 400, statusMessage: 'Квест истёк' })

  const raw = await computeMetric(row.template.metric, userId, orgId, period.start.toISOString(), period.end.toISOString())
  if (raw < row.template.target) throw createError({ statusCode: 400, statusMessage: 'Квест ещё не выполнен' })

  await db.update(userQuest).set({ status: 'claimed', claimedAt: new Date() }).where(eq(userQuest.id, row.id))

  // Award bonus SXP to the current season progress.
  const s = await getOrCreateCurrentSeason()
  await db.insert(userSeasonProgress)
    .values({ userId, organizationId: orgId, seasonId: s.id, bonusSxp: row.template.sxpReward })
    .onConflictDoUpdate({
      target: [userSeasonProgress.organizationId, userSeasonProgress.userId, userSeasonProgress.seasonId],
      set: { bonusSxp: sql`${userSeasonProgress.bonusSxp} + ${row.template.sxpReward}`, updatedAt: new Date() },
    })

  return { success: true, sxpAwarded: row.template.sxpReward }
}
