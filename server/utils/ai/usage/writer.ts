/**
 * Запись событий расхода ИИ — docs/tz-ai-usage.md §3.6.
 *
 * Правила надёжности:
 *  - запись НИКОГДА не ломает и не задерживает основной вызов модели;
 *  - события копятся в буфере процесса и вставляются батчем (50 шт. или раз в 2 с);
 *  - при остановке процесса буфер сбрасывается (server/plugins/ai-usage.ts);
 *  - цена и курс фиксируются в момент вызова (снимок), история не «плывёт».
 */
import { inArray, sql } from 'drizzle-orm'
import { aiUsageEvent } from '../../../database/schema'
import {
  getAiOperation, UNATTRIBUTED_OPERATION,
  type AiFeature, type AiTrigger, type AiUsageStatus,
} from '../../../../shared/aiUsage/catalog'
import { computeCost, estimateTokens, fxRate, normalizeUsage, roundMoney } from '../../../../shared/aiUsage/cost'
import { getOrgCurrencySettings, resolveConfigPricing } from './pricing'

export interface RawAiUsageEvent {
  id: string
  createdAt: Date
  organizationId: string | null
  userId: string | null
  operation: string | null
  traceId: string
  stepNo: number
  trigger: AiTrigger | null
  source: string | null
  jobId: string | null
  entityType: string | null
  entityId: string | null
  purpose: string | null
  aiConfigId: string | null
  provider: string
  model: string
  responseModel: string | null
  mode: 'generate' | 'stream'
  /** Сырой usage провайдера (V3 или SDK-уровень) — нормализуется здесь. */
  usage: unknown
  promptChars: number | null
  completionChars: number | null
  systemPromptHash: string | null
  durationMs: number | null
  ttftMs: number | null
  status: AiUsageStatus
  errorCode: string | null
  errorMessage: string | null
  finishReason: string | null
}

type EventRow = typeof aiUsageEvent.$inferInsert
export type AiUsagePatch = Partial<Pick<EventRow, 'status' | 'errorCode' | 'errorMessage'>>

const FLUSH_SIZE = 50
const FLUSH_DELAY_MS = 2000

const buffer: EventRow[] = []
const pendingPatches = new Map<string, AiUsagePatch>()
const inFlight = new Set<Promise<unknown>>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
const flushListeners: Array<(orgIds: string[]) => void | Promise<void>> = []
const missingOrgWarned = new Set<string>()

/** Подписка на успешную запись батча (проверка бюджетов). */
export function onAiUsageFlushed(fn: (orgIds: string[]) => void | Promise<void>): void {
  flushListeners.push(fn)
}

/** Записать событие (fire-and-forget). Ошибки только логируются. */
export function recordAiUsage(raw: RawAiUsageEvent): void {
  const p = buildRow(raw)
    .then((row) => {
      if (!row) return
      const patch = pendingPatches.get(row.id!)
      if (patch) {
        Object.assign(row, patch)
        pendingPatches.delete(row.id!)
      }
      buffer.push(row)
      scheduleFlush()
    })
    .catch((err) => {
      warn('ai_usage.record_failed', err)
    })
  track(p)
}

/**
 * Поправить уже записанные события (например, structured output: JSON восстановлен
 * или не прошёл схему — модель отработала, но результат пришлось чинить/выбросить).
 */
export function patchAiUsageEvents(ids: string[], patch: AiUsagePatch): void {
  if (!ids.length) return
  const remaining: string[] = []
  for (const id of ids) {
    const row = buffer.find(r => r.id === id)
    if (row) Object.assign(row, patch)
    else remaining.push(id)
  }
  if (!remaining.length) return
  // Событие ещё обогащается (цена) — применим при постановке в буфер; иначе — UPDATE в БД.
  for (const id of remaining) pendingPatches.set(id, { ...(pendingPatches.get(id) ?? {}), ...patch })
  const p = flushAiUsage()
    .then(async () => {
      const toUpdate = remaining.filter(id => pendingPatches.has(id))
      if (!toUpdate.length) return
      for (const id of toUpdate) pendingPatches.delete(id)
      await db.update(aiUsageEvent).set(patch).where(inArray(aiUsageEvent.id, toUpdate))
    })
    .catch(err => warn('ai_usage.patch_failed', err))
  track(p)
}

/** Сбросить буфер в БД (и дождаться событий, которые ещё обогащаются). */
export async function flushAiUsage(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  // Дождаться обогащения уже начатых событий (без рекурсии на собственные промисы flush).
  const pending = [...inFlight]
  if (pending.length) await Promise.allSettled(pending)
  if (!buffer.length) return
  const batch = buffer.splice(0, buffer.length)
  try {
    await db.insert(aiUsageEvent).values(batch).onConflictDoNothing()
  }
  catch (err) {
    warn('ai_usage.flush_failed', err, { batch_size: String(batch.length) })
    return
  }
  const orgIds = [...new Set(batch.map(r => r.organizationId))]
  for (const fn of flushListeners) {
    Promise.resolve().then(() => fn(orgIds)).catch(err => warn('ai_usage.flush_listener_failed', err))
  }
}

function scheduleFlush(): void {
  if (buffer.length >= FLUSH_SIZE) {
    track(flushAiUsage())
    return
  }
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    track(flushAiUsage())
  }, FLUSH_DELAY_MS)
  // Не держать процесс живым ради таймера учёта.
  flushTimer.unref?.()
}

function track(p: Promise<unknown>): void {
  inFlight.add(p)
  p.finally(() => inFlight.delete(p)).catch(() => {})
}

function warn(body: string, err: unknown, extra?: Record<string, string>): void {
  try {
    logWarn(body, { error_message: err instanceof Error ? err.message : String(err), ...(extra ?? {}) })
  }
  catch {
    console.warn(`[ai-usage] ${body}:`, err)
  }
}

/** Собрать строку журнала: атрибуция, токены, снимок цены, стоимость. Экспорт для тестов. */
export async function buildRow(raw: RawAiUsageEvent): Promise<EventRow | null> {
  if (!raw.organizationId) {
    const key = raw.source ?? raw.operation ?? 'unknown'
    if (!missingOrgWarned.has(key)) {
      missingOrgWarned.add(key)
      warn('ai_usage.missing_organization', new Error('ИИ-вызов без организации — событие не записано'), { source: key, operation: raw.operation ?? '' })
    }
    return null
  }

  const def = getAiOperation(raw.operation)
  const operation = def ? def.key : UNATTRIBUTED_OPERATION
  const feature: AiFeature = def ? def.feature : 'unattributed'
  if (!def) {
    warn('ai_usage.unattributed', new Error('ИИ-вызов без операции из каталога'), {
      source: raw.source ?? '',
      operation: raw.operation ?? '',
      model: raw.model,
    })
  }

  // Токены: от провайдера, иначе оценка по длине текста (§6.3).
  const normalized = normalizeUsage(raw.usage)
  const estimated = !normalized && (raw.status === 'ok' || raw.status === 'aborted' || raw.status === 'repaired')
  const usage = normalized ?? {
    inputTokens: estimated ? estimateTokens(raw.promptChars ?? 0) : 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: estimated ? estimateTokens(raw.completionChars ?? 0) : 0,
    reasoningTokens: 0,
  }

  const [pricing, settings] = await Promise.all([
    resolveConfigPricing(raw.organizationId, { id: raw.aiConfigId, provider: raw.provider, model: raw.model }),
    getOrgCurrencySettings(raw.organizationId),
  ])
  const cost = computeCost(usage, pricing.price)
  const rate = fxRate(pricing.price.currency, settings.baseCurrency, settings.usdRubRate)
  const costBase = cost !== null && rate !== null ? roundMoney(cost * rate) : null

  return {
    id: raw.id,
    organizationId: raw.organizationId,
    createdAt: raw.createdAt,
    traceId: raw.traceId,
    stepNo: Math.min(raw.stepNo, 32_000),
    operation,
    feature,
    trigger: raw.trigger ?? def?.defaultTrigger ?? 'user',
    source: raw.source?.slice(0, 200) ?? null,
    userId: raw.userId,
    jobId: raw.jobId,
    entityType: raw.entityType ?? (raw.entityId ? def?.entityType ?? null : null),
    entityId: raw.entityId,
    aiConfigId: pricing.aiConfigId,
    aiConfigName: pricing.aiConfigName,
    purpose: raw.purpose ?? def?.purpose ?? null,
    provider: raw.provider,
    model: raw.model,
    responseModel: raw.responseModel,
    mode: raw.mode,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    tokensEstimated: estimated,
    promptChars: raw.promptChars,
    completionChars: raw.completionChars,
    systemPromptHash: raw.systemPromptHash,
    durationMs: raw.durationMs,
    ttftMs: raw.ttftMs,
    status: raw.status,
    errorCode: raw.errorCode,
    errorMessage: raw.errorMessage?.slice(0, 300) ?? null,
    finishReason: raw.finishReason,
    priceCurrency: pricing.price.currency,
    inputPricePer1m: pricing.price.inputPer1m?.toString() ?? null,
    cachedInputPricePer1m: pricing.price.cachedInputPer1m?.toString() ?? null,
    outputPricePer1m: pricing.price.outputPer1m?.toString() ?? null,
    cost: cost?.toString() ?? null,
    costBase: costBase?.toString() ?? null,
    baseCurrency: settings.baseCurrency,
    fxRate: rate?.toString() ?? null,
    isBackfilled: false,
  }
}

/** Для тестов: состояние буфера. */
export function __aiUsageBufferForTests(): EventRow[] {
  return buffer
}

/** SQL-фрагмент «стоимость в базовой валюте» — общий для агрегатов. */
export const COST_BASE_SQL = sql<number>`coalesce(sum(${aiUsageEvent.costBase}), 0)::float8`
