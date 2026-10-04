/**
 * Export map as Markdown.
 * docs/tz-search-map.md §9.5
 */
export function exportMarkdown(opts: {
  jobTitle: string
  versionLabel?: string
  summary?: string | null
  sections: { title: string; items: { value: string; note?: string | null }[] }[]
  donors: { canonicalName: string; layer: string; priority: string; hypothesisStatus: string; rationale?: string | null }[]
  segments: { name: string; donorLayer?: string | null; titles: string[]; geo: string[]; channelCode?: string | null; queryString?: string | null; priority: string; hypothesisStatus: string }[]
}): string {
  const lines: string[] = []
  lines.push(`# Карта поиска: ${escapeMd(opts.jobTitle)}`)
  if (opts.versionLabel) lines.push(`**Версия:** ${escapeMd(opts.versionLabel)}`)
  if (opts.summary) lines.push(`\n${escapeMd(opts.summary)}`)
  lines.push('')

  lines.push('## Секции')
  for (const section of opts.sections) {
    lines.push(`### ${escapeMd(section.title)}`)
    for (const item of section.items) {
      const note = item.note ? ` — ${escapeMd(item.note)}` : ''
      lines.push(`- ${escapeMd(item.value)}${note}`)
    }
    lines.push('')
  }

  lines.push('## Компании-доноры')
  lines.push('| Компания | Слой | Приоритет | Статус | Причина |')
  lines.push('|---|---|---|---|---|')
  for (const d of opts.donors) {
    lines.push(`| ${escapeMd(d.canonicalName)} | ${d.layer} | ${d.priority} | ${d.hypothesisStatus} | ${escapeMd(d.rationale ?? '')} |`)
  }
  lines.push('')

  lines.push('## Сегменты')
  lines.push('| Сегмент | Слой | Тайтлы | Гео | Канал | Приоритет | Статус |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const s of opts.segments) {
    lines.push(`| ${escapeMd(s.name)} | ${s.donorLayer ?? '—'} | ${s.titles.join(', ')} | ${s.geo.join(', ')} | ${s.channelCode ?? '—'} | ${s.priority} | ${s.hypothesisStatus} |`)
  }

  return lines.join('\n')
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
