import { createHash } from 'node:crypto'

/**
 * Поля hh-резюме, которые меняются от запроса к запросу, но не отражают
 * реальных правок кандидата (просмотры/просчёты hh). Их исключаем перед хешированием.
 */
const VOLATILE_TOP_LEVEL_KEYS = new Set([
  'total_views',
  'new_views',
  'views_url',
  '_links',
  '_attributes',
  'access',
  'paid_services',
  'progress',
  'photo_urls',
  'created_at', // дата создания резюме на hh — не меняется, но иногда сериализуется по-разному
  'updated_at', // обрабатывается отдельно (см. ниже)
])

/**
 * Глубоко сортирует ключи объекта (stable stringify), чтобы hash был воспроизводим
 * независимо от порядка свойств.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return '{' + keys.map((k) => {
    return JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])
  }).join(',') + '}'
}

/**
 * Подготавливает snapshot к хешированию: убирает волатильные поля верхнего уровня.
 */
function normalizeForHash(raw: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (VOLATILE_TOP_LEVEL_KEYS.has(k)) continue
    cleaned[k] = v
  }
  return cleaned
}

/**
 * Считает стабильный sha256 от hh-резюме без волатильных полей.
 * Один и тот же контент даёт один и тот же хеш независимо от порядка ключей.
 */
export function computeResumeContentHash(raw: Record<string, unknown> | null | undefined): string {
  if (!raw) return 'empty'
  const normalized = normalizeForHash(raw)
  const stable = stableStringify(normalized)
  return createHash('sha256').update(stable).digest('hex')
}
