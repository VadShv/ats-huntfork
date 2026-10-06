/**
 * Снимок цены конфигурации и настроек валюты организации — docs/tz-ai-usage.md §3.4.
 * Кэш в памяти процесса на 60 с: цена берётся «на момент вызова» без запроса в БД
 * на каждый шаг агента. Сброс кэша — при изменении ai_config / настроек.
 */
import { and, desc, eq } from 'drizzle-orm'
import { aiConfig, aiUsageSettings } from '../../../database/schema'
import { priceSnapshot, type AiCurrency, type PriceSnapshot } from '../../../../shared/aiUsage/cost'

/** Курс по умолчанию, пока организация не задала свой (как в подсказках цен провайдеров). */
export const DEFAULT_USD_RUB_RATE = 90

const TTL_MS = 60_000

export interface ConfigPricing {
  aiConfigId: string | null
  aiConfigName: string | null
  price: PriceSnapshot
}

export interface OrgCurrencySettings {
  baseCurrency: AiCurrency
  usdRubRate: number
  rateIsDefault: boolean
  retentionDays: number
}

const configCache = new Map<string, { at: number; value: ConfigPricing }>()
const settingsCache = new Map<string, { at: number; value: OrgCurrencySettings }>()

export function invalidateAiPricingCache(orgId?: string): void {
  if (!orgId) {
    configCache.clear()
    settingsCache.clear()
    return
  }
  for (const k of configCache.keys()) if (k.startsWith(`${orgId}|`)) configCache.delete(k)
  settingsCache.delete(orgId)
}

export async function resolveConfigPricing(orgId: string, cfg: {
  id?: string | null
  provider: string
  model: string
}): Promise<ConfigPricing> {
  const key = `${orgId}|${cfg.id ?? ''}|${cfg.provider}|${cfg.model}`
  const hit = configCache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  let row: typeof aiConfig.$inferSelect | undefined
  if (cfg.id) {
    row = await db.query.aiConfig.findFirst({
      where: and(eq(aiConfig.id, cfg.id), eq(aiConfig.organizationId, orgId)),
    })
  }
  if (!row) {
    // Конфиг собран вручную без id — ищем по провайдеру и модели (предпочитая дефолт анализа).
    const rows = await db.select().from(aiConfig)
      .where(and(eq(aiConfig.organizationId, orgId), eq(aiConfig.provider, cfg.provider), eq(aiConfig.model, cfg.model)))
      .orderBy(desc(aiConfig.isDefaultAnalysis), aiConfig.createdAt)
      .limit(1)
    row = rows[0]
  }
  const value: ConfigPricing = {
    aiConfigId: row?.id ?? null,
    aiConfigName: row?.name ?? null,
    price: priceSnapshot(row ?? null),
  }
  configCache.set(key, { at: Date.now(), value })
  return value
}

export async function getOrgCurrencySettings(orgId: string): Promise<OrgCurrencySettings> {
  const hit = settingsCache.get(orgId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const row = await db.query.aiUsageSettings.findFirst({ where: eq(aiUsageSettings.organizationId, orgId) })
  const rate = row?.usdRubRate ? Number(row.usdRubRate) : null
  const value: OrgCurrencySettings = {
    baseCurrency: row?.baseCurrency === 'USD' ? 'USD' : 'RUB',
    usdRubRate: rate && rate > 0 ? rate : DEFAULT_USD_RUB_RATE,
    rateIsDefault: !(rate && rate > 0),
    retentionDays: row?.retentionDays ?? 400,
  }
  settingsCache.set(orgId, { at: Date.now(), value })
  return value
}
