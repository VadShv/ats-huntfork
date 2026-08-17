/**
 * Search Providers — единый поисковый контракт.
 * ТЗ «Модуль поисковой интеграции» §3.
 *
 * Все провайдеры (Yandex, Bright Data, mock) возвращают один и тот же
 * нормализованный контракт. Расширение не знает о провайдерах — только
 * отображает метку provider в UI.
 */

export type SearchEngine = 'yandex' | 'google'

export type SearchProvider = 'yandex' | 'brightdata' | 'brave' | 'mock'

export type SearchErrorCode =
  | 'no_keys'
  | 'rate_limited'
  | 'timeout'
  | 'provider_error'
  | 'empty'
  | 'budget_exceeded'
  | 'network'

/** Запрос к поисковому провайдеру. */
export interface SearchRequest {
  /** X-Ray запрос (site:linkedin.com/in (...) -inurl:dir). */
  query: string
  /** Целевой движок: google (X-Ray) или yandex (RU-площадки). */
  engine: SearchEngine
  /** Гео-фильтр (например, 'Москва'). */
  geo?: string
  /** Язык результатов (например, 'ru'). */
  lang?: string
  /** Число результатов для оценки total_estimate. */
  numResults?: number
  /** ID вакансии — для логирования и кеша по организации. */
  jobId?: string
  /** ID организации — для квот и кеша. */
  orgId?: string
  /** Принудительное обновление (сброс кеша). */
  forceRefresh?: boolean
}

/** Успешный результат поиска. */
export interface SearchResult {
  /** Оценочное число найденных результатов. */
  total: number
  /** Запрос, как его понял поисковик (Google молча исправляет опечатки). */
  detectedQuery?: string
  /** Результат из кеша. */
  cached: boolean
  /** Просроченный кеш — отдаётся сразу, обновление в фоне. */
  stale?: boolean
  /** Какой провайдер дал результат. */
  provider: SearchProvider
  /** ISO-время получения данных. */
  fetchedAt: string
  /** Задержка ответа в мс. */
  latencyMs: number
  /** Стоимость в условных единицах (для будущего cost ledger). */
  costUnits: number
  /** Топ-результаты (URL, заголовок, сниппет). */
  results?: SearchHit[]
}

/** Один результат выдачи. */
export interface SearchHit {
  position: number
  title: string
  url: string
  snippet?: string
  domain: string
}

/** Ошибка поиска. Пустая выдача — НЕ ошибка (valid result, total: 0). */
export interface SearchError {
  code: SearchErrorCode
  message: string
  /** Какой провайдер вернул ошибку. */
  provider?: SearchProvider
}

/** Результат выполнения — либо успех, либо ошибка. */
export type SearchOutcome = SearchResult | SearchError

export function isSearchError(o: SearchOutcome): o is SearchError {
  return 'code' in o
}

export function isSearchResult(o: SearchOutcome): o is SearchResult {
  return 'total' in o
}

/** Тип данных для выбора TTL кеша (§4.2 ТЗ). */
export type CacheTtlType = 'xray' | 'company' | 'digital_trace' | 'generative' | 'empty'
