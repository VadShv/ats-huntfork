/**
 * Бюджеты расхода ИИ — docs/tz-ai-usage.md §7.
 *
 *  - проверка порогов после записи батча событий (дебаунс 30 с на организацию);
 *  - уведомление владельцам/администраторам один раз на (бюджет, период, порог);
 *  - блокировка ТОЛЬКО фоновых вызовов при 100 % и on_exceed = block_background.
 *    Ручные действия пользователя оргбюджет не блокирует никогда.
 *
 * Персональные лимиты участников (scope user / member_default) — в ./limits.ts:
 * они считаются на пользователя и могут останавливать и ручные вызовы.
 */
import { and, eq, gte, inArray, notInArray, sql } from 'drizzle-orm'
import { aiUsageAlert, aiUsageBudget, aiUsageEvent, notification } from '../../../database/schema'
import { member } from '../../../database/schema/auth'
import { aiFeatureLabel, aiOperationLabel, type AiFeature } from '../../../../shared/aiUsage/catalog'
import { crossedThresholds, forecastMonth, formatMoney, fxRate, type AiCurrency } from '../../../../shared/aiUsage/cost'
import { DEFAULT_AI_USAGE_TZ, monthProgress, periodStart } from '../../../../shared/aiUsage/period'
import { getOrgCurrencySettings } from './pricing'
import { checkUserLimits, invalidateUserLimitCache } from './limits'

export type BudgetRow = typeof aiUsageBudget.$inferSelect

export const AI_USAGE_TZ = process.env.AI_USAGE_TZ || DEFAULT_AI_USAGE_TZ

export class AiBudgetExceededError extends Error {
  readonly code = 'AI_BUDGET_EXCEEDED'
  readonly statusCode = 429
  constructor(public readonly budgetId: string, message: string) {
    super(message)
    this.name = 'AiBudgetExceededError'
  }
}

/** Условие «события, попадающие в скоуп бюджета». */
function scopeWhere(b: Pick<BudgetRow, 'organizationId' | 'scope' | 'scopeKey'>, from: Date) {
  const base = [eq(aiUsageEvent.organizationId, b.organizationId), gte(aiUsageEvent.createdAt, from)]
  if (b.scope === 'feature' && b.scopeKey) base.push(eq(aiUsageEvent.feature, b.scopeKey))
  if (b.scope === 'operation' && b.scopeKey) base.push(eq(aiUsageEvent.operation, b.scopeKey))
  if (b.scope === 'user' && b.scopeKey) base.push(eq(aiUsageEvent.userId, b.scopeKey))
  return and(...base)
}

export interface BudgetStatus {
  budget: BudgetRow
  periodStart: Date
  /** Потрачено в валюте бюджета. */
  spent: number
  limit: number
  pct: number
  /** Прогноз на конец периода (для месячных). */
  forecast: number | null
  label: string
}

export function budgetLabel(b: Pick<BudgetRow, 'scope' | 'scopeKey' | 'period'>, userName?: string | null): string {
  const per = b.period === 'day' ? 'день' : 'месяц'
  if (b.scope === 'feature' && b.scopeKey) return `${aiFeatureLabel(b.scopeKey as AiFeature)} · ${per}`
  if (b.scope === 'operation' && b.scopeKey) return `${aiOperationLabel(b.scopeKey)} · ${per}`
  if (b.scope === 'user' && b.scopeKey) return `${userName ?? 'Пользователь'} · ${per}`
  if (b.scope === 'member_default') return `Каждый участник · ${per}`
  return `Вся организация · ${per}`
}

/** Расход по бюджету за текущий период (в валюте бюджета). */
export async function computeBudgetStatus(b: BudgetRow, now = new Date()): Promise<BudgetStatus> {
  const from = periodStart(b.period === 'day' ? 'day' : 'month', now, AI_USAGE_TZ)
  const settings = await getOrgCurrencySettings(b.organizationId)
  const [row] = await db
    .select({ spent: sql<number>`coalesce(sum(${aiUsageEvent.costBase}), 0)::float8` })
    .from(aiUsageEvent)
    .where(scopeWhere(b, from))
  let spent = Number(row?.spent ?? 0)
  // Бюджет мог быть заведён в другой валюте, чем текущая базовая.
  const rate = fxRate(settings.baseCurrency, (b.currency === 'USD' ? 'USD' : 'RUB') as AiCurrency, settings.usdRubRate)
  if (rate !== null) spent *= rate
  const limit = Number(b.limitAmount)
  let forecast: number | null = null
  if (b.period !== 'day') {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
    const [r7] = await db
      .select({ spent: sql<number>`coalesce(sum(${aiUsageEvent.costBase}), 0)::float8` })
      .from(aiUsageEvent)
      .where(scopeWhere(b, sevenDaysAgo > from ? sevenDaysAgo : from))
    const last7 = Number(r7?.spent ?? 0) * (rate ?? 1)
    forecast = forecastMonth({ spentMonthToDate: spent, spentLast7Days: last7, ...monthProgress(now, AI_USAGE_TZ) })
  }
  return {
    budget: b,
    periodStart: from,
    spent,
    limit,
    pct: limit > 0 ? (spent / limit) * 100 : 0,
    forecast,
    label: budgetLabel(b),
  }
}

// ── Проверка порогов ─────────────────────────────────────────────

const lastCheck = new Map<string, number>()
const CHECK_DEBOUNCE_MS = 30_000

/** Вызывается после записи батча. Дебаунс, чтобы не считать суммы на каждый шаг агента. */
export function scheduleBudgetCheck(orgIds: string[]): void {
  const now = Date.now()
  for (const orgId of orgIds) {
    const prev = lastCheck.get(orgId) ?? 0
    if (now - prev < CHECK_DEBOUNCE_MS) continue
    lastCheck.set(orgId, now)
    checkBudgets(orgId).catch((err) => {
      logWarn('ai_usage.budget_check_failed', { org_id: orgId, error_message: err instanceof Error ? err.message : String(err) })
    })
  }
}

export async function checkBudgets(orgId: string, now = new Date()): Promise<number> {
  const budgets = await db.select().from(aiUsageBudget)
    .where(and(eq(aiUsageBudget.organizationId, orgId), eq(aiUsageBudget.isActive, true), notInArray(aiUsageBudget.scope, ['user', 'member_default'])))
  // Персональные лимиты — своя проверка (на каждого участника).
  let created = await checkUserLimits(orgId, now).catch((err) => {
    logWarn('ai_usage.user_limits_check_failed', { org_id: orgId, error_message: err instanceof Error ? err.message : String(err) })
    return 0
  })
  if (!budgets.length) return created
  for (const b of budgets) {
    const st = await computeBudgetStatus(b, now)
    const existing = await db.select({ threshold: aiUsageAlert.threshold }).from(aiUsageAlert)
      .where(and(eq(aiUsageAlert.budgetId, b.id), eq(aiUsageAlert.periodStart, st.periodStart)))
    const thresholds = Array.isArray(b.thresholds) && b.thresholds.length ? b.thresholds : [50, 80, 100]
    const crossed = crossedThresholds(st.spent, st.limit, thresholds, existing.map(e => e.threshold))
    if (!crossed.length) continue
    // Уведомляем только о старшем пересечённом пороге, младшие фиксируем без уведомления.
    const top = Math.max(...crossed)
    const cur = (b.currency === 'USD' ? 'USD' : 'RUB') as AiCurrency
    const message = buildAlertMessage(st, top, cur)
    for (const t of crossed) {
      const inserted = await db.insert(aiUsageAlert).values({
        organizationId: orgId,
        budgetId: b.id,
        periodStart: st.periodStart,
        threshold: t,
        spentAmount: st.spent.toFixed(2),
        limitAmount: st.limit.toFixed(2),
        currency: cur,
        message: t === top ? message : `${st.label}: порог ${t} % пройден`,
      }).onConflictDoNothing().returning({ id: aiUsageAlert.id })
      if (t === top && inserted[0]) {
        await notifyAdmins(orgId, inserted[0].id)
        created++
      }
    }
    if (st.pct >= 100) blockCache.delete(orgId)
  }
  return created
}

function buildAlertMessage(st: BudgetStatus, threshold: number, cur: AiCurrency): string {
  const head = threshold >= 100
    ? `Бюджет ИИ исчерпан (${st.label})`
    : `Расход ИИ достиг ${threshold} % бюджета (${st.label})`
  const parts = [`${head}: ${formatMoney(st.spent, cur)} из ${formatMoney(st.limit, cur)}.`]
  if (st.forecast !== null && st.forecast > st.spent) parts.push(`Прогноз на конец месяца: ${formatMoney(st.forecast, cur)}.`)
  if (threshold >= 100 && st.budget.onExceed === 'block_background') parts.push('Фоновые ИИ-задачи этого бюджета приостановлены до конца периода.')
  return parts.join(' ')
}

async function notifyAdmins(orgId: string, alertId: string): Promise<void> {
  const admins = await db.select({ userId: member.userId, role: member.role }).from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.status, 'active')))
  const targets = admins.filter(m => m.role.split(',').some(r => r.trim() === 'owner' || r.trim() === 'admin'))
  if (!targets.length) return
  await db.insert(notification).values(targets.map(t => ({
    organizationId: orgId,
    userId: t.userId,
    type: 'ai_budget' as const,
    entityType: 'ai_budget',
    entityId: alertId,
    commentId: null,
    actorUserId: null,
  })))
}

// ── Блокировка фоновых вызовов ───────────────────────────────────

const blockCache = new Map<string, { at: number; blocked: Array<Pick<BudgetRow, 'id' | 'scope' | 'scopeKey'> & { label: string }> }>()
const BLOCK_TTL_MS = 60_000

/** Активные бюджеты с block_background, исчерпанные в текущем периоде (кэш 60 с). */
async function exhaustedBlockingBudgets(orgId: string) {
  const hit = blockCache.get(orgId)
  if (hit && Date.now() - hit.at < BLOCK_TTL_MS) return hit.blocked
  const budgets = await db.select().from(aiUsageBudget).where(and(
    eq(aiUsageBudget.organizationId, orgId),
    eq(aiUsageBudget.isActive, true),
    eq(aiUsageBudget.onExceed, 'block_background'),
    notInArray(aiUsageBudget.scope, ['user', 'member_default']),
  ))
  const blocked: Array<Pick<BudgetRow, 'id' | 'scope' | 'scopeKey'> & { label: string }> = []
  for (const b of budgets) {
    const st = await computeBudgetStatus(b)
    if (st.pct >= 100) blocked.push({ id: b.id, scope: b.scope, scopeKey: b.scopeKey, label: st.label })
  }
  blockCache.set(orgId, { at: Date.now(), blocked })
  return blocked
}

/**
 * Бросает AiBudgetExceededError, если фоновый вызов попадает в исчерпанный бюджет
 * с блокировкой. Вызывается middleware только для trigger = 'background'.
 */
export async function assertBackgroundBudget(opts: { organizationId: string; feature: string; operation: string; userId: string | null }): Promise<void> {
  const blocked = await exhaustedBlockingBudgets(opts.organizationId)
  const hit = blocked.find(b =>
    b.scope === 'org'
    || (b.scope === 'feature' && b.scopeKey === opts.feature)
    || (b.scope === 'operation' && b.scopeKey === opts.operation))
  if (hit) {
    throw new AiBudgetExceededError(hit.id, `Отложено: исчерпан бюджет ИИ (${hit.label}). Фоновые ИИ-задачи возобновятся в новом периоде или после увеличения бюджета.`)
  }
}

export function invalidateBudgetCache(orgId: string): void {
  blockCache.delete(orgId)
  lastCheck.delete(orgId)
  invalidateUserLimitCache(orgId)
}

/** Пороги, по которым уже были уведомления в текущем периоде (для UI). */
export async function alertsForBudgets(budgetIds: string[], from: Date) {
  if (!budgetIds.length) return []
  return db.select().from(aiUsageAlert)
    .where(and(inArray(aiUsageAlert.budgetId, budgetIds), gte(aiUsageAlert.periodStart, from)))
}
