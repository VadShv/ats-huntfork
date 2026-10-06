/**
 * Чистые функции учёта расхода ИИ: нормализация токенов и расчёт стоимости.
 * docs/tz-ai-usage.md §6. Без зависимостей от сервера — покрыты unit-тестами.
 */

export const AI_CURRENCIES = ['USD', 'RUB'] as const
export type AiCurrency = typeof AI_CURRENCIES[number]

export interface NormalizedUsage {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
}

export interface PriceSnapshot {
  currency: AiCurrency
  inputPer1m: number | null
  cachedInputPer1m: number | null
  outputPer1m: number | null
}

/** Символов на токен для оценки, когда провайдер не вернул usage (смешанный рус./англ. текст). */
export const CHARS_PER_TOKEN_ESTIMATE = 3.2

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN
  return Number.isFinite(x) && x > 0 ? Math.round(x) : 0
}

/**
 * Привести usage провайдера к единому виду. Понимает:
 *  - LanguageModelV3Usage (middleware): `{ inputTokens: { total, cacheRead, cacheWrite }, outputTokens: { total, reasoning } }`;
 *  - LanguageModelUsage (результат generateText): плоские `inputTokens/outputTokens` + `inputTokenDetails/outputTokenDetails`
 *    и устаревшие `cachedInputTokens/reasoningTokens`.
 * Возвращает null, если провайдер не сообщил ни одного счётчика.
 */
export function normalizeUsage(raw: unknown): NormalizedUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, any>
  const inp = u.inputTokens
  const out = u.outputTokens
  let inputTokens = 0
  let cachedInputTokens = 0
  let cacheWriteTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let seen = false

  if (inp && typeof inp === 'object') {
    if (inp.total != null) seen = true
    inputTokens = n(inp.total)
    cachedInputTokens = n(inp.cacheRead)
    cacheWriteTokens = n(inp.cacheWrite)
  }
  else if (inp != null) {
    seen = true
    inputTokens = n(inp)
    cachedInputTokens = n(u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens)
    cacheWriteTokens = n(u.inputTokenDetails?.cacheWriteTokens)
  }

  if (out && typeof out === 'object') {
    if (out.total != null) seen = true
    outputTokens = n(out.total)
    reasoningTokens = n(out.reasoning)
  }
  else if (out != null) {
    seen = true
    outputTokens = n(out)
    reasoningTokens = n(u.outputTokenDetails?.reasoningTokens ?? u.reasoningTokens)
  }

  if (!seen) return null
  // Защита от несогласованных провайдеров: кэш не больше входа, reasoning не больше выхода.
  cachedInputTokens = Math.min(cachedInputTokens, inputTokens)
  reasoningTokens = Math.min(reasoningTokens, outputTokens)
  return { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens }
}

/** Оценка токенов по длине текста (флаг tokens_estimated). */
export function estimateTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE)
}

const toPrice = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) && x >= 0 ? x : null
}

export function priceSnapshot(cfg: {
  priceCurrency?: string | null
  inputPricePer1m?: string | number | null
  cachedInputPricePer1m?: string | number | null
  outputPricePer1m?: string | number | null
} | null | undefined): PriceSnapshot {
  return {
    currency: cfg?.priceCurrency === 'RUB' ? 'RUB' : 'USD',
    inputPer1m: toPrice(cfg?.inputPricePer1m),
    cachedInputPer1m: toPrice(cfg?.cachedInputPricePer1m),
    outputPer1m: toPrice(cfg?.outputPricePer1m),
  }
}

/** Цена задана, если известна хотя бы цена входа или выхода. */
export function hasPrice(p: PriceSnapshot): boolean {
  return p.inputPer1m !== null || p.outputPer1m !== null
}

/**
 * Стоимость вызова в валюте конфигурации (§6.2):
 *   (input − cached) × in + cached × (cachedIn ?? in) + output × out, всё / 1e6.
 * Reasoning-токены входят в output и отдельно не умножаются.
 * Возвращает null, если цена не задана.
 */
export function computeCost(u: NormalizedUsage, p: PriceSnapshot): number | null {
  if (!hasPrice(p)) return null
  const inPrice = p.inputPer1m ?? 0
  const cachedPrice = p.cachedInputPer1m ?? inPrice
  const outPrice = p.outputPer1m ?? 0
  const billableInput = Math.max(0, u.inputTokens - u.cachedInputTokens)
  const cost = (billableInput * inPrice + u.cachedInputTokens * cachedPrice + u.outputTokens * outPrice) / 1_000_000
  return roundMoney(cost)
}

/** Курс пересчёта из валюты конфигурации в базовую валюту организации. */
export function fxRate(from: AiCurrency, base: AiCurrency, usdRub: number | null): number | null {
  if (from === base) return 1
  if (!usdRub || !Number.isFinite(usdRub) || usdRub <= 0) return null
  if (from === 'USD' && base === 'RUB') return usdRub
  if (from === 'RUB' && base === 'USD') return roundRate(1 / usdRub)
  return null
}

export function roundMoney(x: number): number {
  return Math.round(x * 1e6) / 1e6
}

function roundRate(x: number): number {
  return Math.round(x * 1e6) / 1e6
}

/**
 * Прогноз расхода на конец месяца (§7.4): линейная экстраполяция с начала месяца;
 * если последние 7 дней дороже среднего — экстраполяция по последним 7 дням.
 */
export function forecastMonth(opts: {
  spentMonthToDate: number
  spentLast7Days: number
  dayOfMonth: number
  daysInMonth: number
}): number {
  const { spentMonthToDate, spentLast7Days, dayOfMonth, daysInMonth } = opts
  if (dayOfMonth <= 0) return spentMonthToDate
  const avg = spentMonthToDate / dayOfMonth
  const recentWindow = Math.min(7, dayOfMonth)
  const recent = recentWindow > 0 ? spentLast7Days / recentWindow : 0
  const daily = recent > avg ? recent : avg
  const remaining = Math.max(0, daysInMonth - dayOfMonth)
  return roundMoney(spentMonthToDate + daily * remaining)
}

/** Пороги бюджета, впервые пересечённые расходом (в процентах). */
export function crossedThresholds(spent: number, limit: number, thresholds: number[], alreadyNotified: number[]): number[] {
  if (!(limit > 0)) return []
  const pct = (spent / limit) * 100
  const done = new Set(alreadyNotified)
  return [...thresholds].sort((a, b) => a - b).filter(t => pct >= t && !done.has(t))
}

const CURRENCY_SYMBOL: Record<AiCurrency, string> = { USD: '$', RUB: '₽' }

/** Форматирование суммы: мелкие суммы с большим числом знаков, чтобы не показывать «0 ₽». */
export function formatMoney(amount: number | null | undefined, currency: AiCurrency = 'RUB'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—'
  const abs = Math.abs(amount)
  const digits = abs === 0 ? 0 : abs < 0.01 ? 4 : abs < 1 ? 3 : abs < 100 ? 2 : 0
  const s = amount.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return currency === 'USD' ? `$${s}` : `${s} ${CURRENCY_SYMBOL[currency]}`
}

export function formatTokens(v: number | null | undefined): string {
  if (!v) return '0'
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн`
  if (v >= 10_000) return `${(v / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс.`
  return v.toLocaleString('ru-RU')
}
