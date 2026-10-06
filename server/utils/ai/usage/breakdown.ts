/**
 * Разрезы расхода ИИ (docs/tz-ai-usage.md §8.1, блоки 3–4). Используется
 * эндпоинтами breakdown и export.csv.
 */
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { aiConfig, aiUsageEvent, application } from '../../../database/schema'
import {
  AI_OPERATIONS, AI_TRIGGER_LABELS, aiFeatureLabel, aiFeatureOf, aiOperationLabel, getAiOperation, type AiTrigger,
} from '../../../../shared/aiUsage/catalog'
import { computeCost, fxRate, priceSnapshot, type AiCurrency } from '../../../../shared/aiUsage/cost'
import { getOrgCurrencySettings } from './pricing'
import { aggColumns, jobTitles, normalizeAgg, usageFilterSchema, usageWhere, userNames, type AggRow, type UsageFilters } from './query'

export const BREAKDOWN_DIMENSIONS = ['operation', 'feature', 'model', 'config', 'user', 'job', 'trigger'] as const
export type BreakdownBy = typeof BREAKDOWN_DIMENSIONS[number]

export const breakdownQuerySchema = usageFilterSchema.extend({
  by: z.enum(BREAKDOWN_DIMENSIONS).default('operation'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export interface BreakdownRow extends AggRow {
  key: string
  label: string
  /** Доп. поля разреза (feature, topModel, provider, applications …). */
  [extra: string]: unknown
}

export interface BreakdownResult {
  by: BreakdownBy
  rows: BreakdownRow[]
  totalCost: number
  totalCalls: number
  hints: Array<{ text: string; saving: number | null; operations: string[] }>
}

const e = aiUsageEvent

function groupColumns(by: BreakdownBy): { select: Record<string, SQL>; group: SQL[] } {
  const k = (expr: SQL) => ({ select: { key: expr }, group: [expr] })
  switch (by) {
    case 'operation': return k(sql<string>`${e.operation}`)
    case 'feature': return k(sql<string>`${e.feature}`)
    case 'trigger': return k(sql<string>`${e.trigger}`)
    case 'user': return k(sql<string>`coalesce(${e.userId}, '')`)
    case 'job': return k(sql<string>`coalesce(${e.jobId}, '')`)
    case 'model': {
      const model = sql<string>`${e.model}`
      const provider = sql<string>`${e.provider}`
      return { select: { key: model, provider }, group: [model, provider] }
    }
    case 'config': {
      const id = sql<string>`coalesce(${e.aiConfigId}, '')`
      return { select: { key: id, name: sql<string | null>`max(${e.aiConfigName})` }, group: [id] }
    }
  }
}

export async function getBreakdown(orgId: string, f: UsageFilters, by: BreakdownBy, limit = 200): Promise<BreakdownResult> {
  const cols = groupColumns(by)
  const raw = await db.select({
    ...cols.select,
    ...aggColumns(),
    topModel: sql<string | null>`mode() within group (order by ${e.model})`,
    background: sql<number>`count(*) filter (where ${e.trigger} = 'background')::int`,
    lengthCut: sql<number>`count(*) filter (where ${e.finishReason} = 'length')::int`,
  }).from(e).where(usageWhere(orgId, f)).groupBy(...cols.group)
    .orderBy(desc(sql`coalesce(sum(${e.costBase}), 0)`), desc(sql`count(*)`))
    .limit(limit)

  const rows: BreakdownRow[] = raw.map((r) => {
    const n = normalizeAgg(r as unknown as AggRow & Record<string, unknown>)
    const key = String((r as unknown as { key: unknown }).key ?? '')
    return {
      ...n,
      key,
      label: key,
      topModel: (r as { topModel?: string | null }).topModel ?? null,
      background: Number((r as { background?: number }).background ?? 0),
      lengthCut: Number((r as { lengthCut?: number }).lengthCut ?? 0),
    } as BreakdownRow
  })

  const totalCost = rows.reduce((s, r) => s + r.cost, 0)
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0)
  for (const r of rows) {
    r.share = totalCost > 0 ? r.cost / totalCost : 0
    r.avgCostPerTrace = r.traces ? r.cost / r.traces : 0
    r.errorRate = r.calls ? r.errors / r.calls : 0
    r.reasoningShare = r.outputTokens ? r.reasoningTokens / r.outputTokens : 0
  }

  const hints: BreakdownResult['hints'] = []

  switch (by) {
    case 'operation':
      for (const r of rows) {
        const def = getAiOperation(r.key)
        r.label = aiOperationLabel(r.key)
        r.feature = def?.feature ?? aiFeatureOf(r.key)
        r.featureLabel = aiFeatureLabel(String(r.feature))
        r.costNote = def?.costNote ?? null
      }
      break
    case 'feature':
      for (const r of rows) r.label = aiFeatureLabel(r.key)
      break
    case 'trigger':
      for (const r of rows) r.label = AI_TRIGGER_LABELS[r.key as AiTrigger] ?? r.key
      break
    case 'model': {
      for (const r of rows) {
        const tokens = r.inputTokens + r.outputTokens
        r.label = r.key
        r.costPer1kTokens = tokens > 0 ? (r.cost / tokens) * 1000 : null
      }
      hints.push(...await structuringHints(orgId, f))
      break
    }
    case 'config':
      for (const r of rows) r.label = (r.name as string | null) || (r.key ? 'Конфигурация удалена' : 'Без конфигурации')
      break
    case 'user': {
      const names = await userNames(rows.map(r => r.key))
      const top = await topOperations(orgId, f, 'user', rows.map(r => r.key))
      for (const r of rows) {
        r.label = r.key ? (names.get(r.key) ?? 'Удалённый пользователь') : 'Система / без пользователя'
        r.backgroundShare = r.calls ? Number(r.background) / r.calls : 0
        r.topOperations = top.get(r.key) ?? []
      }
      break
    }
    case 'job': {
      const ids = rows.map(r => r.key).filter(Boolean)
      const titles = await jobTitles(ids)
      const top = await topOperations(orgId, f, 'job', rows.map(r => r.key))
      const apps = ids.length
        ? await db.select({
            jobId: application.jobId,
            applications: sql<number>`count(*)::int`,
            hired: sql<number>`count(*) filter (where ${application.status} = 'hired')::int`,
          }).from(application)
            .where(and(eq(application.organizationId, orgId), inArray(application.jobId, ids)))
            .groupBy(application.jobId)
        : []
      const appsBy = new Map(apps.map(a => [a.jobId, a]))
      for (const r of rows) {
        r.label = r.key ? (titles.get(r.key) ?? 'Удалённая вакансия') : 'Без вакансии'
        const a = appsBy.get(r.key)
        r.applications = a ? Number(a.applications) : 0
        r.hired = a ? Number(a.hired) : 0
        r.costPerApplication = r.applications ? r.cost / Number(r.applications) : null
        r.costPerHire = r.hired ? r.cost / Number(r.hired) : null
        r.topOperations = top.get(r.key) ?? []
      }
      break
    }
  }

  return { by, rows, totalCost, totalCalls, hints }
}

async function topOperations(orgId: string, f: UsageFilters, dim: 'user' | 'job', keys: string[]) {
  const out = new Map<string, Array<{ key: string; label: string; cost: number; calls: number }>>()
  const ids = keys.filter(Boolean)
  if (!ids.length) return out
  const col = dim === 'user' ? e.userId : e.jobId
  const rows = await db.select({
    dimKey: col,
    operation: e.operation,
    cost: sql<number>`coalesce(sum(${e.costBase}), 0)::float8`,
    calls: sql<number>`count(*)::int`,
  }).from(e).where(usageWhere(orgId, f, [inArray(col, ids)])).groupBy(col, e.operation)
  for (const r of rows) {
    const k = r.dimKey ?? ''
    const list = out.get(k) ?? []
    list.push({ key: r.operation, label: aiOperationLabel(r.operation), cost: Number(r.cost), calls: Number(r.calls) })
    out.set(k, list)
  }
  for (const [k, list] of out) out.set(k, list.sort((a, b) => b.cost - a.cost || b.calls - a.calls).slice(0, 3))
  return out
}

/**
 * Подсказка §8.1-4: операции с purpose = structuring, выполненные не на конфигурации
 * «структурирование», — сколько стоили бы на ней.
 */
async function structuringHints(orgId: string, f: UsageFilters): Promise<BreakdownResult['hints']> {
  const structCfg = await db.query.aiConfig.findFirst({
    where: and(eq(aiConfig.organizationId, orgId), eq(aiConfig.isDefaultStructuring, true)),
  })
  if (!structCfg) return []
  const price = priceSnapshot(structCfg)
  if (price.inputPer1m === null && price.outputPer1m === null) return []
  const settings = await getOrgCurrencySettings(orgId)
  const rate = fxRate(price.currency, settings.baseCurrency as AiCurrency, settings.usdRubRate) ?? 1

  const structOps: string[] = AI_OPERATIONS.filter(o => o.purpose === 'structuring').map(o => o.key)
  if (!structOps.length) return []
  const rows = await db.select({
    operation: e.operation,
    cost: sql<number>`coalesce(sum(${e.costBase}), 0)::float8`,
    inputTokens: sql<number>`coalesce(sum(${e.inputTokens}), 0)::bigint`,
    cachedInputTokens: sql<number>`coalesce(sum(${e.cachedInputTokens}), 0)::bigint`,
    outputTokens: sql<number>`coalesce(sum(${e.outputTokens}), 0)::bigint`,
  }).from(e).where(usageWhere(orgId, f, [
    inArray(e.operation, structOps),
    sql`coalesce(${e.aiConfigId}, '') <> ${structCfg.id}`,
  ])).groupBy(e.operation)

  let saving = 0
  const ops: string[] = []
  for (const r of rows) {
    const est = computeCost({
      inputTokens: Number(r.inputTokens),
      cachedInputTokens: Number(r.cachedInputTokens),
      cacheWriteTokens: 0,
      outputTokens: Number(r.outputTokens),
      reasoningTokens: 0,
    }, price)
    if (est === null) continue
    const diff = Number(r.cost) - est * rate
    if (diff > 0) {
      saving += diff
      ops.push(r.operation)
    }
  }
  if (!ops.length || saving <= 0) return []
  const days = Math.max(1, (f.to.getTime() - f.from.getTime()) / 86_400_000)
  return [{
    text: `Операции ${ops.map(aiOperationLabel).join(', ')} можно перевести на конфигурацию «${structCfg.name}» (структурирование)`,
    saving: (saving / days) * 30,
    operations: ops,
  }]
}

/** Статистика операций за 30 дней (каталог операций, Банк промптов §8.4). */
export async function operationStats30d(orgId: string, userId?: string | null) {
  const now = new Date()
  const f: UsageFilters = { from: new Date(now.getTime() - 30 * 86_400_000), to: now, userId: userId ?? undefined }
  const rows = await db.select({
    operation: e.operation,
    calls: sql<number>`count(*)::int`,
    traces: sql<number>`count(distinct ${e.traceId})::int`,
    cost: sql<number>`coalesce(sum(${e.costBase}), 0)::float8`,
    avgInput: sql<number | null>`avg(${e.inputTokens})::float8`,
    avgOutput: sql<number | null>`avg(${e.outputTokens})::float8`,
    errors: sql<number>`count(*) filter (where ${e.status} in ('error','timeout','aborted'))::int`,
    topModel: sql<string | null>`mode() within group (order by ${e.model})`,
    versions: sql<number>`count(distinct ${e.systemPromptHash})::int`,
    lastAt: sql<string | null>`max(${e.createdAt})`,
  }).from(e).where(usageWhere(orgId, f)).groupBy(e.operation)
  return new Map(rows.map(r => [r.operation, {
    calls: Number(r.calls),
    traces: Number(r.traces),
    cost: Number(r.cost),
    avgCostPerCall: Number(r.calls) ? Number(r.cost) / Number(r.calls) : 0,
    avgInputTokens: r.avgInput === null ? 0 : Math.round(Number(r.avgInput)),
    avgOutputTokens: r.avgOutput === null ? 0 : Math.round(Number(r.avgOutput)),
    errors: Number(r.errors),
    topModel: r.topModel,
    versions: Number(r.versions),
    lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
  }]))
}
