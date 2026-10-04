/**
 * Normalize a company name for deduplication and matching.
 *
 * Steps: trim → NFKC → lower → ё→е → strip quotes → strip legal forms
 * → strip punctuation (except &+.-) → collapse whitespace.
 *
 * @example
 *   normalizeCompanyName('ООО «Яндекс»')   → 'яндекс'
 *   normalizeCompanyName('Yandex LLC')      → 'yandex'
 *   normalizeCompanyName('T-Bank')          → 't-bank'
 *   normalizeCompanyName('Сбер')            → 'сбер'  (≠ 'сбербанк')
 */
export function normalizeCompanyName(raw: string): string {
  if (!raw) return ''

  return raw
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["«»“”''`]/g, ' ')
    .replace(/(?<![\p{L}\p{N}])(ооо|оао|зао|пао|ао|ип|нко|гк|ip|nko|llc|inc|ltd|gmbh|corp|co|group|holding|групп|холдинг|company)(?![\p{L}\p{N}])/giu, ' ')
    .replace(/[^\p{L}\p{N}&+.\-\s]/gu, ' ')
    .replace(/\s\.\s/g, ' ')
    .replace(/\s\.$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeAlias(alias: string): string {
  return normalizeCompanyName(alias)
}
