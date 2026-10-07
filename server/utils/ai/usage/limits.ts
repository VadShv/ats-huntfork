/**
 * Персональные лимиты на ИИ — docs/design-profile-and-token-limits.md §3.
 *
 * Лимит хранится в деньгах (валюта лимита = базовая валюта организации на момент создания),
 * на пользователя, с периодом день/месяц. Хранится в ai_usage_budget:
 *   scope = 'user'            — личный лимит участника (scope_key = user_id);
 *   scope = 'member_default'  — лимит по умолчанию для каждого участника без личного.
 * Owner и admin по умолчанию под member_default не попадают, но личный лимит им поставить можно.
 *
 * Расход считается по ai_usage_event.user_id. События без цены (конфигурация без цен)
 * оцениваются по резервной цене организации, чтобы не обходить лимит.
 *
 * on_exceed = 'block_all' останавливает любые вызовы пользователя (ручные, расширение, фоновые
 * от его имени) при 100 %; 'notify' — только уведомления; 'block_background' (старые записи) —
 * только фоновые.
 */
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { aiUsageAlert, aiUsageBudget, aiUsageEvent, notification } from '../../../database/schema'
import { member, user } from '../../../database/schema/auth'
import type { AiTrigger } from '../../../../shared/aiUsage/catalog'
import { crossedThresholds, formatMoney, fxRate, type AiCurrency } from '../../../../shared/aiUsage/cost'
import { DEFAULT_AI_USAGE_TZ, periodEnd, periodStart } from '../../../../shared/aiUsage/period'
import { effectiveFallbackPrice, getOrgCurrencySettings } from './pricing'

export const AI_LIMITS_TZ = process.env.AI_USAGE_TZ || DEFAULT_AI_USAGE_TZ

type BudgetRow = typeof aiUsageBudget.$inferSelect
export type LimitPeriod = 'day' | 'month'
const PERIODS: LimitPeriod[] = ['day', 'month']

export class AiLimitExceededError extends Error {
  readonly code = 'AI_BUDGET_EXCEEDED'
  readonly statusCode = 429
  readonly statusMessage: string
  readonly data: { code: 'AI_BUDGET_EXCEEDED'; kind: 'user_limit'; period: LimitPeriod; resetAt: string }
  constructor(message: string, period: LimitPeriod, resetAt: Date) {
    super(message)
    this.name = 'AiLimitExceededError'
    this.statusMessage = message
    this.data = { code: 'AI_BUDGET_EXCEEDED', kind: 'user_limit', period, resetAt: resetAt.toISOString() }
  }
}

// ── Участники и роли ─────────────────────────────────────────────

export function isPrivilegedRole(role: string | null | undefined): boolean {
  return (role ?? '').split(',').some(r => r.trim() === 'owner' || r.trim() === 'admin')
}

export interface OrgMemberLite { userId: string; name: string; email: string; image: string | null; role: string }

export async function activeMembers(orgId: string): Promise<OrgMemberLite[]> {
  const rows = await db.select({ userId: member.userId, role: member.role, name: user.name, email: user.email, image: user.image })
    .from(member).innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), eq(member.status, 'active')))
  return rows.map(r => ({ userId: r.userId, role: r.role, name: r.name || r.email, email: r.email, image: r.image ?? null }))
}

// ── Разрешение лимитов ───────────────────────────────────────────

export interface EffectiveLimit {
  budget: BudgetRow
  /** true — унаследован от «по умолчанию для всех». */
  inherited: boolean
}
export type UserLimits = Record<LimitPeriod, EffectiveLimit | null>

interface OrgLimitRows { at: number; personal: BudgetRow[]; defaults: BudgetRow[] }
const rowsCache = new Map<string, OrgLimitRows>()
const TTL_MS = 60_000

async function orgLimitRows(orgId: string): Promise<OrgLimitRows> {
  const hit = rowsCache.get(orgId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit
  const rows = await db.select().from(aiUsageBudget).where(and(
    eq(aiUsageBudget.organizationId, orgId),
    eq(aiUsageBudget.isActive, true),
    inArray(aiUsageBudget.scope, ['user', 'member_default']),
  ))
  const value: OrgLimitRows = {
    at: Date.now(),
    personal: rows.filter(r => r.scope === 'user'),
    defaults: rows.filter(r => r.scope === 'member_default'),
  }
  rowsCache.set(orgId, value)
  return value
}

/** Лимит по умолчанию для всех участников (по периодам). */
export async function defaultLimits(orgId: string): Promise<Record<LimitPeriod, BudgetRow | null>> {
  const rows = await orgLimitRows(orgId)
  return {
    day: rows.defaults.find(r => r.period === 'day') ?? null,
    month: rows.defaults.find(r => r.period === 'month') ?? null,
  }
}

/** Действующие лимиты пользователя: личный → по умолчанию (кроме owner/admin) → нет. */
export async function resolveUserLimits(orgId: string, userId: string, role?: string | null): Promise<UserLimits> {
  const rows = await orgLimitRows(orgId)
  let privileged = role !== undefined ? isPrivilegedRole(role) : null
  const out: UserLimits = { day: null, month: null }
  for (const period of PERIODS) {
    const own = rows.personal.find(r => r.scopeKey === userId && r.period === period)
    if (own) {
      out[period] = { budget: own, inherited: false }
      continue
    }
    const def = rows.defaults.find(r => r.period === period)
    if (!def) continue
    if (privileged === null) {
      const m = await db.query.member.findFirst({ where: and(eq(member.organizationId, orgId), eq(member.userId, userId)) })
      privileged = isPrivilegedRole(m?.role)
    }
    if (!privileged) out[period] = { budget: def, inherited: true }
  }
  return out
}

// ── Расход ───────────────────────────────────────────────────────

/** Стоимость события для лимита: cost_base, а без цены — токены × резервная цена. */
export function limitCostExpr(fallbackPricePer1m: number) {
  const fb = Number.isFinite(fallbackPricePer1m) && fallbackPricePer1m > 0 ? fallbackPricePer1m : 0
  return sql<number>`coalesce(sum(coalesce(${aiUsageEvent.costBase}, (${aiUsageEvent.inputTokens} + ${aiUsageEvent.outputTokens}) * ${sql.raw(String(fb))} / 1000000.0)), 0)::float8`
}

export interface UserPeriodUsage {
  period: LimitPeriod
  periodStart: Date
  periodEnd: Date
  /** В базовой валюте организации. */
  spent: number
  calls: number
  inputTokens: number
  outputTokens: number
  /** Сколько вызовов без цены оценено по резервной цене. */
  noPriceCalls: number
}

export async function userPeriodUsage(orgId: string, userIds: string[], period: LimitPeriod, now = new Date()): Promise<Map<string, UserPeriodUsage>> {
  const from = periodStart(period, now, AI_LIMITS_TZ)
  const to = periodEnd(period, now, AI_LIMITS_TZ)
  const out = new Map<string, UserPeriodUsage>()
  if (!userIds.length) return out
  const fb = await effectiveFallbackPrice(orgId)
  const rows = await db.select({
    userId: aiUsageEvent.userId,
    spent: limitCostExpr(fb),
    calls: sql<number>`count(*)::int`,
    inputTokens: sql<number>`coalesce(sum(${aiUsageEvent.inputTokens}), 0)::bigint`,
    outputTokens: sql<number>`coalesce(sum(${aiUsageEvent.outputTokens}), 0)::bigint`,
    noPriceCalls: sql<number>`count(*) filter (where ${aiUsageEvent.costBase} is null)::int`,
  }).from(aiUsageEvent).where(and(
    eq(aiUsageEvent.organizationId, orgId),
    inArray(aiUsageEvent.userId, userIds),
    gte(aiUsageEvent.createdAt, from),
    lt(aiUsageEvent.createdAt, to),
  )).groupBy(aiUsageEvent.userId)
  for (const r of rows) {
    if (!r.userId) continue
    out.set(r.userId, {
      period, periodStart: from, periodEnd: to,
      spent: Number(r.spent ?? 0), calls: Number(r.calls ?? 0),
      inputTokens: Number(r.inputTokens ?? 0), outputTokens: Number(r.outputTokens ?? 0),
      noPriceCalls: Number(r.noPriceCalls ?? 0),
    })
  }
  for (const id of userIds) {
    if (!out.has(id)) out.set(id, { period, periodStart: from, periodEnd: to, spent: 0, calls: 0, inputTokens: 0, outputTokens: 0, noPriceCalls: 0 })
  }
  return out
}

export interface UserLimitStatus {
  period: LimitPeriod
  budgetId: string | null
  inherited: boolean
  /** В базовой валюте организации; null — лимита нет. */
  limit: number | null
  spent: number
  pct: number | null
  onExceed: 'notify' | 'block_background' | 'block_all' | null
  blocked: boolean
  periodStart: string
  resetAt: string
  calls: number
  inputTokens: number
  outputTokens: number
  noPriceCalls: number
}

function limitInBase(b: BudgetRow, base: AiCurrency, usdRub: number): number {
  const cur: AiCurrency = b.currency === 'USD' ? 'USD' : 'RUB'
  const rate = fxRate(cur, base, usdRub) ?? 1
  return Number(b.limitAmount) * rate
}

function toStatus(period: LimitPeriod, lim: EffectiveLimit | null, usage: UserPeriodUsage, base: AiCurrency, usdRub: number): UserLimitStatus {
  const limit = lim ? limitInBase(lim.budget, base, usdRub) : null
  const pct = limit && limit > 0 ? (usage.spent / limit) * 100 : null
  const onExceed = (lim?.budget.onExceed ?? null) as UserLimitStatus['onExceed']
  return {
    period,
    budgetId: lim?.budget.id ?? null,
    inherited: lim?.inherited ?? false,
    limit, spent: usage.spent, pct, onExceed,
    blocked: pct !== null && pct >= 100 && onExceed === 'block_all',
    periodStart: usage.periodStart.toISOString(),
    resetAt: usage.periodEnd.toISOString(),
    calls: usage.calls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, noPriceCalls: usage.noPriceCalls,
  }
}

/** Статусы лимитов одного пользователя по обоим периодам. */
export async function userLimitStatuses(orgId: string, userId: string, role?: string | null, now = new Date()): Promise<Record<LimitPeriod, UserLimitStatus>> {
  const [limits, settings, day, month] = await Promise.all([
    resolveUserLimits(orgId, userId, role),
    getOrgCurrencySettings(orgId),
    userPeriodUsage(orgId, [userId], 'day', now),
    userPeriodUsage(orgId, [userId], 'month', now),
  ])
  return {
    day: toStatus('day', limits.day, day.get(userId)!, settings.baseCurrency, settings.usdRubRate),
    month: toStatus('month', limits.month, month.get(userId)!, settings.baseCurrency, settings.usdRubRate),
  }
}

/** Статусы для всех активных участников (таблица в настройках). */
export async function membersLimitStatuses(orgId: string, now = new Date()) {
  const members = await activeMembers(orgId)
  const ids = members.map(m => m.userId)
  const [settings, day, month] = await Promise.all([
    getOrgCurrencySettings(orgId),
    userPeriodUsage(orgId, ids, 'day', now),
    userPeriodUsage(orgId, ids, 'month', now),
  ])
  const out: Array<OrgMemberLite & { privileged: boolean; day: UserLimitStatus; month: UserLimitStatus }> = []
  for (const m of members) {
    const limits = await resolveUserLimits(orgId, m.userId, m.role)
    out.push({
      ...m,
      privileged: isPrivilegedRole(m.role),
      day: toStatus('day', limits.day, day.get(m.userId)!, settings.baseCurrency, settings.usdRubRate),
      month: toStatus('month', limits.month, month.get(m.userId)!, settings.baseCurrency, settings.usdRubRate),
    })
  }
  return { currency: settings.baseCurrency, members: out }
}

// ── Блокировка ───────────────────────────────────────────────────

const blockedCache = new Map<string, { at: number; hit: UserLimitStatus | null }>()
const BLOCK_TTL_MS = 60_000

/**
 * Бросает AiLimitExceededError, если у пользователя исчерпан лимит с блокировкой.
 * trigger: ручные/расширение/фон останавливает block_all; block_background — только фон.
 * Результат кэшируется 60 с на (организация, пользователь); сброс — после записи батча.
 */
export async function assertUserLimit(orgId: string, userId: string, trigger: AiTrigger | null): Promise<void> {
  if (trigger === 'system') return
  const key = `${orgId}|${userId}`
  const cached = blockedCache.get(key)
  let hit: UserLimitStatus | null
  if (cached && Date.now() - cached.at < BLOCK_TTL_MS) {
    hit = cached.hit
  }
  else {
    const st = await userLimitStatuses(orgId, userId)
    hit = [st.day, st.month].find(s => s.pct !== null && s.pct >= 100 && (s.onExceed === 'block_all' || s.onExceed === 'block_background')) ?? null
    blockedCache.set(key, { at: Date.now(), hit })
  }
  if (!hit) return
  if (hit.onExceed === 'block_background' && trigger !== 'background') return
  const settings = await getOrgCurrencySettings(orgId)
  const per = hit.period === 'day' ? 'Дневной' : 'Месячный'
  const reset = formatResetAt(new Date(hit.resetAt))
  const msg = `${per} лимит ИИ исчерпан: ${formatMoney(hit.spent, settings.baseCurrency)} из ${formatMoney(hit.limit ?? 0, settings.baseCurrency)}. Сброс ${reset}. Увеличить лимит может владелец или администратор организации.`
  throw new AiLimitExceededError(msg, hit.period, new Date(hit.resetAt))
}

export function formatResetAt(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: AI_LIMITS_TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(d) + ' МСК'
}

/** После записи батча: заново проверить блокировки участников организации (строки лимитов не трогаем). */
export function clearUserBlockCache(orgId: string): void {
  for (const k of blockedCache.keys()) if (k.startsWith(`${orgId}|`)) blockedCache.delete(k)
}

export function invalidateUserLimitCache(orgId: string, userId?: string): void {
  rowsCache.delete(orgId)
  if (userId) blockedCache.delete(`${orgId}|${userId}`)
  else for (const k of blockedCache.keys()) if (k.startsWith(`${orgId}|`)) blockedCache.delete(k)
}

// ── Пороги и уведомления ─────────────────────────────────────────

/**
 * Проверка порогов персональных лимитов всех участников организации.
 * Уведомление: 50/80 % — самому участнику; 100 % — участнику и owner/admin.
 * Один раз на (лимит, период, порог, участник). Возвращает число отправленных уведомлений.
 */
export async function checkUserLimits(orgId: string, now = new Date()): Promise<number> {
  const rows = await orgLimitRows(orgId)
  if (!rows.personal.length && !rows.defaults.length) return 0
  const { members, currency } = await membersLimitStatuses(orgId, now)
  const admins = members.filter(m => m.privileged).map(m => m.userId)
  let sent = 0
  for (const m of members) {
    for (const st of [m.day, m.month]) {
      if (!st.budgetId || st.limit === null || st.pct === null) continue
      const budget = [...rows.personal, ...rows.defaults].find(b => b.id === st.budgetId)
      if (!budget) continue
      const periodStartDate = new Date(st.periodStart)
      const existing = await db.select({ threshold: aiUsageAlert.threshold }).from(aiUsageAlert)
        .where(and(eq(aiUsageAlert.budgetId, budget.id), eq(aiUsageAlert.periodStart, periodStartDate), eq(aiUsageAlert.userId, m.userId)))
      const thresholds = Array.isArray(budget.thresholds) && budget.thresholds.length ? budget.thresholds : [50, 80, 100]
      const crossed = crossedThresholds(st.spent, st.limit, thresholds, existing.map(e => e.threshold))
      if (!crossed.length) continue
      const top = Math.max(...crossed)
      for (const t of crossed) {
        const message = buildUserLimitMessage(m.name, st, t, currency)
        const inserted = await db.insert(aiUsageAlert).values({
          organizationId: orgId,
          budgetId: budget.id,
          userId: m.userId,
          periodStart: periodStartDate,
          threshold: t,
          spentAmount: st.spent.toFixed(2),
          limitAmount: st.limit.toFixed(2),
          currency,
          message,
        }).onConflictDoNothing().returning({ id: aiUsageAlert.id })
        if (t !== top || !inserted[0]) continue
        const targets = new Set<string>([m.userId])
        if (t >= 100) for (const a of admins) targets.add(a)
        await db.insert(notification).values([...targets].map(uid => ({
          organizationId: orgId,
          userId: uid,
          type: 'ai_budget' as const,
          entityType: 'ai_limit',
          entityId: inserted[0]!.id,
          commentId: null,
          actorUserId: null,
        })))
        sent += targets.size
      }
      if (st.pct >= 100) blockedCache.delete(`${orgId}|${m.userId}`)
    }
  }
  return sent
}

function buildUserLimitMessage(name: string, st: UserLimitStatus, threshold: number, cur: AiCurrency): string {
  const per = st.period === 'day' ? 'дневного' : 'месячного'
  const head = threshold >= 100
    ? `${name}: ${st.period === 'day' ? 'дневной' : 'месячный'} лимит ИИ исчерпан`
    : `${name}: израсходовано ${threshold} % ${per} лимита ИИ`
  const parts = [`${head} — ${formatMoney(st.spent, cur)} из ${formatMoney(st.limit ?? 0, cur)}.`]
  if (threshold >= 100 && st.onExceed === 'block_all') parts.push(`ИИ-действия приостановлены до ${formatResetAt(new Date(st.resetAt))}.`)
  return parts.join(' ')
}

/** Запрос на увеличение лимита: уведомление owner/admin с текстом от участника. */
export async function requestLimitIncrease(orgId: string, userId: string, period: LimitPeriod, comment?: string): Promise<number> {
  const [st, members, settings] = await Promise.all([userLimitStatuses(orgId, userId), activeMembers(orgId), getOrgCurrencySettings(orgId)])
  const me = members.find(m => m.userId === userId)
  const s = st[period]
  if (!s.budgetId || s.limit === null) throw createError({ statusCode: 400, statusMessage: 'На этот период лимит не задан' })
  const admins = members.filter(m => isPrivilegedRole(m.role) && m.userId !== userId)
  if (!admins.length) return 0
  const per = period === 'day' ? 'дневной' : 'месячный'
  const text = `${me?.name ?? 'Участник'} просит увеличить ${per} лимит ИИ (сейчас ${formatMoney(s.spent, settings.baseCurrency)} из ${formatMoney(s.limit, settings.baseCurrency)}).${comment ? ` «${comment}»` : ''}`
  const [alert] = await db.insert(aiUsageAlert).values({
    organizationId: orgId,
    budgetId: s.budgetId,
    userId,
    periodStart: new Date(s.periodStart),
    threshold: 0,
    spentAmount: s.spent.toFixed(2),
    limitAmount: s.limit.toFixed(2),
    currency: settings.baseCurrency,
    message: text,
  }).onConflictDoNothing().returning({ id: aiUsageAlert.id })
  if (!alert) throw createError({ statusCode: 409, statusMessage: 'Запрос на этот период уже отправлен' })
  await db.insert(notification).values(admins.map(a => ({
    organizationId: orgId,
    userId: a.userId,
    type: 'ai_budget' as const,
    entityType: 'ai_limit_request',
    entityId: alert.id,
    commentId: null,
    actorUserId: userId,
  })))
  return admins.length
}
