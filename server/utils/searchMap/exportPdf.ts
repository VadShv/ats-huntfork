/**
 * Export search map as print-friendly HTML (browser → Save as PDF).
 * docs/tz-search-map.md §9.5
 */
export function exportHtml(opts: {
  jobTitle: string
  versionLabel?: string
  summary?: string | null
  sections: { title: string; items: { value: string; note?: string | null }[] }[]
  donors: { canonicalName: string; layer: string; priority: string; hypothesisStatus: string; rationale?: string | null }[]
  segments: { name: string; donorLayer?: string | null; titles: string[]; geo: string[]; channelCode?: string | null; queryString?: string | null; priority: string; hypothesisStatus: string }[]
}): string {
  const layerLabels: Record<string, string> = {
    core: 'Ядро', adjacent: 'Смежный', school: 'Школы', alumni: 'Alumni', custom: 'Своё',
  }
  const statusLabels: Record<string, string> = {
    untested: 'Не проверена', in_progress: 'В работе', working: 'Работает', rejected: 'Отклонена',
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const sectionsHtml = opts.sections.map(s => `
    <h3>${esc(s.title)}</h3>
    <ul>${s.items.map(i => `<li>${esc(i.value)}${i.note ? ` — <em>${esc(i.note)}</em>` : ''}</li>`).join('')}</ul>
  `).join('')

  const donorsHtml = opts.donors.map(d => `<tr>
    <td>${esc(d.canonicalName)}</td><td>${layerLabels[d.layer] ?? d.layer}</td><td>${d.priority}</td><td>${statusLabels[d.hypothesisStatus] ?? d.hypothesisStatus}</td><td>${esc(d.rationale ?? '')}</td>
  </tr>`).join('')

  const segmentsHtml = opts.segments.map(s => `<tr>
    <td>${esc(s.name)}</td><td>${s.donorLayer ? (layerLabels[s.donorLayer] ?? s.donorLayer) : '—'}</td><td>${s.channelCode ?? '—'}</td><td>${s.priority}</td><td>${statusLabels[s.hypothesisStatus] ?? s.hypothesisStatus}</td>
  </tr>`).join('')

  const queriesHtml = opts.segments.filter(s => s.queryString).map(s => `
    <p><strong>${esc(s.name)}</strong><br><code>${esc(s.queryString!)}</code></p>
  `).join('')

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Карта поиска: ${esc(opts.jobTitle)}</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 24px; } h3 { font-size: 13px; margin-top: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
  th { background: #f5f5f5; } ul { font-size: 12px; padding-left: 20px; } li { margin: 2px 0; }
  code { font-size: 11px; } .meta { color: #888; font-size: 11px; margin-bottom: 16px; }
  @media print { body { max-width: none; } }
</style>
</head>
<body onload="window.print()">
<h1>Карта поиска: ${esc(opts.jobTitle)}</h1>
<div class="meta">${opts.versionLabel ? `Версия: ${esc(opts.versionLabel)} | ` : ''}Дата: ${new Date().toLocaleDateString('ru-RU')}</div>
${opts.summary ? `<p>${esc(opts.summary)}</p>` : ''}
<h2>Секции</h2>${sectionsHtml}
<h2>Компании-доноры</h2>
<table><tr><th>Компания</th><th>Слой</th><th>Приоритет</th><th>Статус</th><th>Причина</th></tr>${donorsHtml}</table>
<h2>Сегменты</h2>
<table><tr><th>Сегмент</th><th>Слой</th><th>Канал</th><th>Приоритет</th><th>Статус</th></tr>${segmentsHtml}</table>
${queriesHtml ? `<h2>Строки запросов</h2>${queriesHtml}` : ''}
</body></html>`
}
