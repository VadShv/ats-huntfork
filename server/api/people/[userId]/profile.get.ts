/**
 * GET /api/people/:userId/profile — публичный (внутри организации) профиль участника
 * (docs/design-profile-and-token-limits.md §2.3). Усечённая информация: имя, роль, команда,
 * экипированные рамка/титул/акцент, ранг и дивизион, метрики найма за сезон и всё время,
 * полученные достижения, уровень Хант-пасса, похвалы (kudos) и открытые вакансии,
 * где человек — основной рекрутер (только те, что видит смотрящий).
 *
 * Никаких приватных данных: email не отдаём, расход ИИ и лимиты — нет, запрещённые
 * вакансии вырезаются по scope смотрящего.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { gamificationTeam, gamificationTeamMember, job, jobMember, kudos, rankHistory, userInventory, userRank, userSeasonProgress } from '../../../database/schema'
import { member, user } from '../../../database/schema/auth'
import { getLevel } from '../../../../shared/achievements-catalog'
import { GAMIFICATION_CONFIG } from '../../../../shared/gamification-config'
import { DIVISIONS, LEGEND, divisionForRp } from '../../../../shared/ranks-catalog'
import { ROLE_PRESET_BY_KEY } from '../../../../shared/access/role-presets'
import { SHOP_CATALOG } from '../../../../shared/shop-catalog'
import { tierForSxp, TIER_COUNT } from '../../../../shared/season-track'
import { checkAchievements } from '../../../utils/achievements/check'
import { resolveUserScopeJobIds } from '../../../utils/access/scope'
import { getOrCreateCurrentSeason } from '../../../utils/huntpass/season'
import { computeSeasonSxp } from '../../../utils/huntpass/sxp'
import { computeOrgRp, computeUserRp } from '../../../utils/ranks/rp'

const EPOCH_ISO = '1970-01-01T00:00:00.000Z'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const { userId } = await getValidatedRouterParams(event, z.object({ userId: z.string().min(1).max(100) }).parse)
  const viewerId = session.user.id

  // Участник той же организации, активный.
  const [target] = await db.select({
    role: member.role, status: member.status, memberSince: member.createdAt,
    name: user.name, image: user.image,
  }).from(member).innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  if (!target || target.status !== 'active') throw createError({ statusCode: 404, statusMessage: 'Участник не найден' })

  const roleKeys = target.role.split(',').map(r => r.trim()).filter(Boolean)
  const roleLabel = roleKeys.map(k => ROLE_PRESET_BY_KEY[k]?.nameRu ?? k).join(', ')

  const now = new Date()
  const season = await getOrCreateCurrentSeason(now)
  const seasonStart = season.startsAt.toISOString()
  const seasonEnd = season.endsAt.toISOString()

  const [teamRow, inventory, rpMap, rankState, history, allTime, achievementsRes, seasonProgress, sxp, kudosCount, kudosLast, viewerScope] = await Promise.all([
    db.select({ id: gamificationTeam.id, name: gamificationTeam.name, color: gamificationTeam.color })
      .from(gamificationTeamMember).innerJoin(gamificationTeam, eq(gamificationTeam.id, gamificationTeamMember.teamId))
      .where(and(eq(gamificationTeamMember.organizationId, orgId), eq(gamificationTeamMember.userId, userId), eq(gamificationTeam.isArchived, false)))
      .limit(1).then(r => r[0] ?? null),
    db.select({ itemKey: userInventory.itemKey, itemType: userInventory.itemType }).from(userInventory)
      .where(and(eq(userInventory.organizationId, orgId), eq(userInventory.userId, userId), eq(userInventory.equipped, true))),
    computeOrgRp(orgId, seasonStart, seasonEnd),
    db.query.userRank.findFirst({ where: and(eq(userRank.organizationId, orgId), eq(userRank.userId, userId), eq(userRank.seasonId, season.id)) }),
    db.query.rankHistory.findMany({
      where: and(eq(rankHistory.organizationId, orgId), eq(rankHistory.userId, userId), eq(rankHistory.seasonId, season.id)),
      orderBy: (t, { asc }) => [asc(t.weekKey)],
    }),
    computeUserRp(userId, orgId, EPOCH_ISO, now.toISOString()),
    checkAchievements(userId, orgId, false),
    db.query.userSeasonProgress.findFirst({ where: and(eq(userSeasonProgress.organizationId, orgId), eq(userSeasonProgress.userId, userId), eq(userSeasonProgress.seasonId, season.id)) }),
    computeSeasonSxp(userId, orgId, season.startsAt, season.endsAt),
    db.select({ cnt: sql<number>`count(*)::int` }).from(kudos).where(and(eq(kudos.organizationId, orgId), eq(kudos.toUserId, userId))).then(r => Number(r[0]?.cnt ?? 0)),
    db.select({ id: kudos.id, reason: kudos.reason, createdAt: kudos.createdAt, fromName: user.name, fromUserId: kudos.fromUserId })
      .from(kudos).innerJoin(user, eq(user.id, kudos.fromUserId))
      .where(and(eq(kudos.organizationId, orgId), eq(kudos.toUserId, userId)))
      .orderBy(desc(kudos.createdAt)).limit(3),
    resolveUserScopeJobIds(orgId, viewerId),
  ])

  // ── Ранг (та же логика, что GET /api/rank) ──
  const mine = rpMap.get(userId) ?? { rp: 0, hires: 0, offers: 0, interviews: 0, vacanciesClosed: 0, avgResponseHours: null, quality: 1, speed: 1 }
  const ranked = [...rpMap.entries()].sort((a, b) => b[1].rp - a[1].rp)
  const position = ranked.findIndex(([uid]) => uid === userId) + 1
  const isLegend = ranked.slice(0, GAMIFICATION_CONFIG.rank.legendTopN).filter(([, r]) => r.rp > 0).some(([uid]) => uid === userId)
  const liveInfo = divisionForRp(mine.rp)
  const divKey = rankState?.status === 'ranked' ? rankState.division : liveInfo.division
  const divMeta = DIVISIONS.find(d => d.key === divKey) ?? DIVISIONS[0]!
  const subrank = rankState?.status === 'ranked' ? rankState.subrank : liveInfo.subrank

  // ── Экипировка ──
  const equipped = inventory.map(i => SHOP_CATALOG.find(c => c.key === i.itemKey)).filter(Boolean) as typeof SHOP_CATALOG
  const frame = equipped.find(e => e.type === 'frame') ?? null
  const title = equipped.find(e => e.type === 'title') ?? null
  const accent = equipped.find(e => e.type === 'accent') ?? null

  // ── Открытые вакансии, где человек — основной рекрутер, в scope смотрящего ──
  const jobWhere = [eq(job.organizationId, orgId), eq(job.status, 'open'), eq(jobMember.userId, userId), eq(jobMember.memberRole, 'recruiter'), eq(jobMember.isPrimary, true)]
  if (viewerScope !== null) {
    if (!viewerScope.length) jobWhere.push(sql`false`)
    else jobWhere.push(inArray(job.id, viewerScope))
  }
  const openJobs = await db.select({ id: job.id, title: job.title, createdAt: job.createdAt })
    .from(job).innerJoin(jobMember, eq(jobMember.jobId, job.id))
    .where(and(...jobWhere)).orderBy(desc(job.createdAt)).limit(10)

  const earned = achievementsRes.achievements.filter(a => a.earned)
    .sort((a, b) => (b.earnedAt ?? '').localeCompare(a.earnedAt ?? ''))
  const totalSxp = sxp.sxp + (seasonProgress?.bonusSxp ?? 0)

  return {
    user: {
      id: userId,
      name: target.name,
      image: target.image ?? null,
      roleLabel,
      roleKeys,
      memberSince: target.memberSince?.toISOString() ?? null,
      isMe: viewerId === userId,
    },
    team: teamRow,
    equipped: {
      frame: frame ? { key: frame.key, name: frame.name, value: frame.value } : null,
      title: title ? { key: title.key, name: title.name, value: title.value } : null,
      accent: accent ? { key: accent.key, name: accent.name, value: accent.value } : null,
    },
    season: { name: season.name, quarter: season.quarter, year: season.year, daysLeft: Math.max(0, Math.ceil((season.endsAt.getTime() - now.getTime()) / 86_400_000)) },
    rank: {
      rp: mine.rp,
      division: isLegend
        ? { key: LEGEND.key, name: LEGEND.name, icon: LEGEND.icon, subrank: 0, isLegend: true }
        : { key: divKey, name: divMeta.name, icon: divMeta.icon, subrank, isLegend: false },
      placement: (!rankState || rankState.status === 'placement') && !isLegend,
      position: position || null,
      total: ranked.length,
      trend: history.slice(-8).map(h => h.rp),
    },
    metrics: {
      season: { hires: mine.hires, offers: mine.offers, interviews: mine.interviews, vacanciesClosed: mine.vacanciesClosed, avgResponseHours: mine.avgResponseHours },
      allTime: { hires: allTime.hires, offers: allTime.offers, interviews: allTime.interviews, vacanciesClosed: allTime.vacanciesClosed, avgResponseHours: allTime.avgResponseHours },
    },
    achievements: {
      earnedCount: earned.length,
      totalCount: achievementsRes.achievements.filter(a => !a.isHidden || a.earned).length,
      level: getLevel(achievementsRes.totalXp),
      totalXp: achievementsRes.totalXp,
      items: earned.slice(0, 12).map(a => ({ key: a.key, name: a.name, description: a.description, icon: a.icon, tier: a.tier, category: a.category, points: a.points, earnedAt: a.earnedAt })),
    },
    huntpass: { sxp: totalSxp, tier: tierForSxp(totalSxp), tierCount: TIER_COUNT, isPremium: seasonProgress?.isPremium ?? false },
    kudos: { total: kudosCount, last: kudosLast.map(k => ({ id: k.id, reason: k.reason, createdAt: k.createdAt.toISOString(), fromUserId: k.fromUserId, fromName: k.fromName })) },
    openJobs: openJobs.map(j => ({ id: j.id, title: j.title, createdAt: j.createdAt.toISOString() })),
  }
})
