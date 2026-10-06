/**
 * «Расход ИИ» — общие фильтры, единицы и форматирование (docs/tz-ai-usage.md §8).
 *
 * Фильтры живут в URL (?period=30d&feature=screening…), чтобы ссылку можно было
 * переслать и вернуться к тому же срезу. Единица отображения: базовая валюта
 * организации, альтернативная (пересчёт по курсу организации) или токены.
 */
import { formatMoney, formatTokens, type AiCurrency } from '~~/shared/aiUsage/cost'

export type AiUsagePeriod = '7d' | '30d' | '90d' | 'month' | 'prev_month'
export type AiUsageUnit = 'base' | 'alt' | 'tokens'

export const AI_USAGE_FILTER_KEYS = [
  'period', 'from', 'to', 'feature', 'operation', 'model', 'aiConfigId', 'userId', 'jobId', 'trigger', 'status',
  'entityType', 'entityId',
] as const
export type AiUsageFilterKey = typeof AI_USAGE_FILTER_KEYS[number]
export type AiUsageFilters = Partial<Record<AiUsageFilterKey, string>>

export const AI_USAGE_PERIOD_OPTIONS: Array<{ value: AiUsagePeriod; label: string }> = [
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: '90d', label: '90 дней' },
  { value: 'month', label: 'Этот месяц' },
  { value: 'prev_month', label: 'Прошлый месяц' },
]

/** Фильтры из URL + запись обратно (router.replace, без новой записи в истории). */
export function useAiUsageFilters() {
  const route = useRoute()
  const router = useRouter()

  const filters = computed<AiUsageFilters>(() => {
    const out: AiUsageFilters = {}
    for (const k of AI_USAGE_FILTER_KEYS) {
      const v = route.query[k]
      if (typeof v === 'string' && v) out[k] = v
    }
    if (!out.period && !out.from) out.period = '30d'
    return out
  })

  function setFilter(key: AiUsageFilterKey, value: string | null | undefined) {
    const q: Record<string, string | undefined> = { ...(route.query as Record<string, string>) }
    if (value) q[key] = value
    else delete q[key]
    if (key === 'period') { delete q.from; delete q.to }
    router.replace({ query: q })
  }

  function setFilters(patch: AiUsageFilters) {
    const q: Record<string, string | undefined> = { ...(route.query as Record<string, string>) }
    for (const [k, v] of Object.entries(patch)) {
      if (v) q[k] = v
      else delete q[k]
    }
    router.replace({ query: q })
  }

  function resetFilters() {
    const q: Record<string, string | undefined> = { ...(route.query as Record<string, string>) }
    for (const k of AI_USAGE_FILTER_KEYS) if (k !== 'period') delete q[k]
    router.replace({ query: q })
  }

  const activeCount = computed(() =>
    AI_USAGE_FILTER_KEYS.filter(k => k !== 'period' && k !== 'from' && k !== 'to' && filters.value[k]).length)

  return { filters, setFilter, setFilters, resetFilters, activeCount }
}

/** Единицы и форматирование сумм. `rate` — USD→RUB организации. */
export function useAiUsageMoney(opts: {
  baseCurrency: Ref<AiCurrency | undefined | null>
  usdRubRate: Ref<number | undefined | null>
}) {
  const unit = useState<AiUsageUnit>('ai-usage-unit', () => 'base')

  const base = computed<AiCurrency>(() => opts.baseCurrency.value ?? 'RUB')
  const alt = computed<AiCurrency>(() => (base.value === 'RUB' ? 'USD' : 'RUB'))
  const displayCurrency = computed<AiCurrency>(() => (unit.value === 'alt' ? alt.value : base.value))

  function convert(v: number | null | undefined): number | null {
    if (v === null || v === undefined) return null
    if (unit.value !== 'alt') return v
    const r = opts.usdRubRate.value || 90
    return base.value === 'RUB' ? v / r : v * r
  }

  /** Сумма в выбранной валюте (в режиме «токены» — тоже деньги; для токенов есть tokens()). */
  function money(v: number | null | undefined): string {
    return formatMoney(convert(v), displayCurrency.value)
  }

  const unitOptions = computed(() => [
    { value: 'base' as AiUsageUnit, label: base.value === 'RUB' ? '₽' : '$' },
    { value: 'alt' as AiUsageUnit, label: alt.value === 'RUB' ? '₽' : '$' },
    { value: 'tokens' as AiUsageUnit, label: 'Токены' },
  ])

  return { unit, base, alt, displayCurrency, convert, money, tokens: formatTokens, unitOptions }
}

export function formatPct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${(v * 100).toLocaleString('ru-RU', { maximumFractionDigits: digits })} %`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  if (ms < 60_000) return `${(ms / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} с`
  return `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} с`
}

export function formatDateTimeRu(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Убирает пустые значения — для query в $fetch/useFetch. */
export function compactQuery(q: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') out[k] = String(v)
  return out
}

export const AI_STATUS_TONE: Record<string, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  repaired: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
  timeout: 'text-red-600 dark:text-red-400',
  aborted: 'text-surface-500',
}
