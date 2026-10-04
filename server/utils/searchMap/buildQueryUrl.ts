/**
 * Build segment name and query URL.
 * docs/tz-search-map.md §6.5, §9.4
 */

const LAYER_LABELS: Record<string, string> = {
  core: 'Ядро',
  adjacent: 'Смежный',
  school: 'Школы',
  alumni: 'Alumni',
  custom: 'Своё',
}

/**
 * Auto-generate segment name from its components.
 * Format: [Слой] × [первые 2 тайтла] × [первое гео] × [канал]
 */
export function buildSegmentName(opts: {
  donorLayer?: string | null
  titles?: string[]
  geo?: string[]
  channelName?: string | null
}): string {
  const parts: string[] = []
  if (opts.donorLayer) parts.push(LAYER_LABELS[opts.donorLayer] ?? opts.donorLayer)
  if (opts.titles?.length) parts.push(opts.titles.slice(0, 2).join(', '))
  if (opts.geo?.length) parts.push(opts.geo[0])
  if (opts.channelName) parts.push(opts.channelName)
  return parts.join(' × ')
}

/**
 * Build query URL from channel template and query string.
 * For channels with targetSite: prepends `site:{targetSite} ` automatically.
 */
export function buildQueryUrl(opts: {
  queryString?: string | null
  urlTemplate?: string | null
  targetSite?: string | null
  titles?: string[]
  geo?: string[]
}): string | null {
  if (!opts.urlTemplate || !opts.queryString) return null

  let query = opts.queryString
  if (opts.targetSite) {
    query = `site:${opts.targetSite} ${query}`
  }

  let url = opts.urlTemplate.replace('{query}', encodeURIComponent(query))
  if (opts.titles?.length) url = url.replace('{title}', encodeURIComponent(opts.titles[0]))
  if (opts.geo?.length) url = url.replace('{geo}', encodeURIComponent(opts.geo[0]))

  return url
}
