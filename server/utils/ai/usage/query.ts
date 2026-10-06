/**
 * Общие части API «Расход ИИ» (docs/tz-ai-usage.md §9–10): доступ, фильтры,
 * SQL-выражения агрегатов. Все эндпоинты server/api/ai-usage/* идут через этот модуль,
 * чтобы правила «view_own → только свои», «без view_costs → без сумм» были в одном месте.
 */
import type { H3Event } from 'h3'
import { and, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { aiUsageEvent } from '../../../database/schema'
import { getActorContext } from '../../access/actorContext'
import { canBool } from '../../access/can'
import { AI_FEATURES, AI_STATUSES, AI_TRIGGERS } from '../../../../shared/aiUsage/catalog'
import { DEFAULT_AI_USAGE_TZ, periodStart, zonedMidnightUtc } from '../../../../shared/aiUsage/period'
import { getOrgCurrencySettings, type OrgCurrencySettings } from './pricing'

export const AI_USAGE_TIMEZONE = process.env.AI_USAGE_TZ || DEFAULT_AI_USAGE_TZ

// ── Доступ ───────────────────────────────────────────────────────

export interface AiUsageAccess {
  orgId: string
  userId: string
  canViewOrg: boolean
  canViewCosts: boolean
  canExport: boolean
  canManageBudgets: boolean
  canRecalculate: boolean
  currency: OrgCurrencySettings
}

/**
 * Требует хотя бы aiUsage:view_own. Возвращает флаги прав и настройки валюты.
 * `need` — дополнительное обязательное право (manage_budgets / export / recalculate).
 */
export async function requireAiUsageAccess(
  event: H3Event,
  need?: 'view_org' | 'view_costs' | 'manage_budgets' | 'export' | 'recalculate',
): Promise<AiUsageAccess> {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const actor = await getActorContext(event)
  const has = (a: string) => canBool(actor, `aiUsage:${a}` as never)
  const canViewOrg = has('view_org')
  if (!canViewOrg && !has('view_own')) {
    throw createError({ statusCode: 403, statusMessage: 'Нет доступа к расходу ИИ' })
  }
  const access: AiUsageAccess = {
    orgId,
    userId: session.user.id,
    canViewOrg,
    canViewCosts: has('view_costs'),
    canExport: has('export'),
    canManageBudgets: has('manage_budgets'),
    canRecalculate: has('recalculate'),
    currency: await getOrgCurrencySettings(orgId),
  }
  if (need && !has(need)) {
    throw createError({ statusCode: 403, statusMessage: 'Недостаточно прав для этого действия' })
  }
  return access
}

// ── Фильтры ──────────────────────────────────────────────────────

const optStr = z.string().trim().min(1).max(200).optional()

export const usageFilterSchema = z.object({
  /** 7d | 30d | 90d | month | prev_month; игнорируется, если заданы from/to. */
  period: z.enum(['7d', '30d', '90d', 'month', 'prev_month']).optional(),
  from: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  to: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  feature: z.enum(AI_FEATURES as unknown as [string, ...string[]]).optional(),
  operation: optStr,
  model: optStr,
  aiConfigId: optStr,
  userId: optStr,
  jobId: optStr,
  trigger: z.enum(AI_TRIGGERS as unknown as [string, ...string[]]).optional(),
  status: z.enum(AI_STATUSES as unknown as [string, ...string[]]).optional(),
  entityType: optStr,
  entityId: optStr,
})

export type UsageFilterInput = z.infer<typeof usageFilterSchema>

export interface UsageFilters {
  from: Date
  to: Date
  feature?: string
  operation?: string
  model?: string
  aiConfigId?: string
  userId?: string
  jobId?: string
  trigger?: string
  status?: string
  entityType?: string
  entityId?: string
}

function parseDateParam(v: string, endOfDay: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number]
    // Конец дня = полночь следующего дня (граница исключается).
    return endOfDay ? zonedMidnightUtc(y, m, d + 1, AI_USAGE_TIMEZONE) : zonedMidnightUtc(y, m, d, AI_USAGE_TIMEZONE)
  }
  return new Date(v)
}

/** Разбор query → фильтры. Без view_org пользователь всегда видит только свои вызовы. */
export function resolveUsageFilters(q: UsageFilterInput, access: Pick<AiUsageAccess, 'canViewOrg' | 'userId'>, now = new Date()): UsageFilters {
  let from: Date
  let to: Date = now
  if (q.from) {
    from = parseDateParam(q.from, false)
    to = q.to ? parseDateParam(q.to, true) : now
  }
  else {
    switch (q.period ?? '30d') {
      case '7d': from = new Date(now.getTime() - 7 * 86_400_000); break
      case '90d': from = new Date(now.getTime() - 90 * 86_400_000); break
      case 'month': from = periodStart('month', now, AI_USAGE_TIMEZONE); break
      case 'prev_month': {
        const cur = periodStart('month', now, AI_USAGE_TIMEZONE)
        from = periodStart('month', new Date(cur.getTime() - 86_400_000), AI_USAGE_TIMEZONE)
        to = cur
        break
      }
      default: from = new Date(now.getTime() - 30 * 86_400_000)
    }
  }
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw createError({ statusCode: 400, statusMessage: 'Неверный период' })
  }
  return {
    from,
    to,
    feature: q.feature,
    operation: q.operation,
    model: q.model,
    aiConfigId: q.aiConfigId,
    userId: access.canViewOrg ? q.userId : access.userId,
    jobId: q.jobId,
    trigger: q.trigger,
    status: q.status,
    entityType: q.entityType,
    entityId: q.entityId,
  }
}

/** Предыдущий период той же длины — для «изменения к прошлому периоду». */
export function previousPeriod(f: UsageFilters): UsageFilters {
  const len = f.to.getTime() - f.from.getTime()
  return { ...f, from: new Date(f.from.getTime() - len), to: f.from }
}

export function usageWhere(orgId: string, f: UsageFilters, extra: Array<SQL | undefined> = []): SQL {
  const e = aiUsageEvent
  const conds: Array<SQL | undefined> = [
    eq(e.organizationId, orgId),
    gte(e.createdAt, f.from),
    lt(e.createdAt, f.to),
    f.feature ? eq(e.feature, f.feature) : undefined,
    f.operation ? eq(e.operation, f.operation) : undefined,
    f.model ? eq(e.model, f.model) : undefined,
    f.aiConfigId ? eq(e.aiConfigId, f.aiConfigId) : undefined,
    f.userId ? eq(e.userId, f.userId) : undefined,
    f.jobId ? eq(e.jobId, f.jobId) : undefined,
    f.trigger ? eq(e.trigger, f.trigger) : undefined,
    f.status ? eq(e.status, f.status) : undefined,
    f.entityType ? eq(e.entityType, f.entityType) : undefined,
    f.entityId ? eq(e.entityId, f.entityId) : undefined,
    ...extra,
  ]
  return and(...conds.filter(Boolean)) as SQL
}

// ── Агрегаты ─────────────────────────────────────────────────────

const e = aiUsageEvent
export const LOSS_STATUSES = ['error', 'timeout', 'aborted'] as const

/** Стандартный набор агрегатов для строки разреза. */
export function aggColumns() {
  return {
    calls: sql<number>`count(*)::int`,
    traces: sql<number>`count(distinct ${e.traceId})::int`,
    inputTokens: sql<number>`coalesce(sum(${e.inputTokens}), 0)::bigint`,
    cachedInputTokens: sql<number>`coalesce(sum(${e.cachedInputTokens}), 0)::bigint`,
    outputTokens: sql<number>`coalesce(sum(${e.outputTokens}), 0)::bigint`,
    reasoningTokens: sql<number>`coalesce(sum(${e.reasoningTokens}), 0)::bigint`,
    cost: sql<number>`coalesce(sum(${e.costBase}), 0)::float8`,
    errors: sql<number>`count(*) filter (where ${e.status} in ('error','timeout','aborted'))::int`,
    lossCost: sql<number>`coalesce(sum(${e.costBase}) filter (where ${e.status} in ('error','timeout','aborted')), 0)::float8`,
    noPrice: sql<number>`count(*) filter (where ${e.costBase} is null and ${e.status} <> 'error')::int`,
    estimated: sql<number>`count(*) filter (where ${e.tokensEstimated})::int`,
    avgDurationMs: sql<number | null>`avg(${e.durationMs})::float8`,
    lastAt: sql<string | null>`max(${e.createdAt})`,
  }
}

export interface AggRow {
  calls: number
  traces: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  cost: number
  errors: number
  lossCost: number
  noPrice: number
  estimated: number
  avgDurationMs: number | null
  lastAt: string | null
}

/** bigint из postgres-js приходит строкой — приводим к числам. */
export function normalizeAgg<T extends Partial<AggRow>>(r: T): T {
  const out: Record<string, unknown> = { ...r }
  for (const k of ['calls', 'traces', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'cost', 'errors', 'lossCost', 'noPrice', 'estimated'] as const) {
    if (k in out) out[k] = Number(out[k] ?? 0)
  }
  if ('avgDurationMs' in out) out.avgDurationMs = out.avgDurationMs === null || out.avgDurationMs === undefined ? null : Math.round(Number(out.avgDurationMs))
  if ('lastAt' in out && out.lastAt) out.lastAt = new Date(out.lastAt as string).toISOString()
  return out as T
}

/** Убирает денежные поля, если у пользователя нет view_costs (§9). */
const MONEY_KEY = /cost|price|amount|spent|limit|forecast|share$/i
const KEEP_KEYS = new Set(['reasoningShare', 'errorShare', 'backgroundShare', 'costNote'])

export function stripCosts<T>(row: T, canViewCosts: boolean): T {
  if (canViewCosts || row === null || typeof row !== 'object') return row
  if (Array.isArray(row)) return row.map(r => stripCosts(r, false)) as T
  if (row instanceof Date) return row
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    // Флаги прав (canViewCosts …) и токенные доли оставляем.
    if (!k.startsWith('can') && !KEEP_KEYS.has(k) && MONEY_KEY.test(k)) continue
    out[k] = v && typeof v === 'object' ? stripCosts(v, false) : v
  }
  return out as T
}

/**
 * Локальная дата бакета (день/неделя) в часовом поясе отчётов.
 * created_at — timestamp без зоны, хранит UTC (как во всём проекте): сначала `AT TIME ZONE 'UTC'`,
 * затем `AT TIME ZONE tz` даёт локальное время (как в server/utils/achievements/metrics.ts).
 * Значения вставляются литералами (не параметрами): одинаковое выражение
 * в SELECT и GROUP BY с разными $n Postgres не считает одним и тем же.
 */
export function bucketExpr(interval: 'day' | 'week') {
  const unit = interval === 'week' ? 'week' : 'day'
  const tz = AI_USAGE_TIMEZONE.replace(/'/g, "''")
  return sql<string>`to_char(date_trunc('${sql.raw(unit)}', ${e.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE '${sql.raw(tz)}'), 'YYYY-MM-DD')`
}

export async function userNames(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return new Map()
  const { user } = await import('../../../database/schema/auth')
  const rows = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(inArray(user.id, uniq))
  return new Map(rows.map(r => [r.id, r.name || r.email]))
}

export async function jobTitles(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return new Map()
  const { job } = await import('../../../database/schema')
  const rows = await db.select({ id: job.id, title: job.title }).from(job).where(inArray(job.id, uniq))
  return new Map(rows.map(r => [r.id, r.title]))
}

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = v instanceof Date ? v.toISOString() : String(v)
  // Защита от CSV-инъекции формул в Excel: текст, начинающийся с = + - @, экранируем апострофом.
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
