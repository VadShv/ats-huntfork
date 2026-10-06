/**
 * Рендер документ-модели карты поиска в печатный HTML и в Markdown.
 * docs/tz-search-map-v2.md §3.2. Без Vue и без DOM — работает на сервере (экспорт)
 * и может использоваться на клиенте для window.print().
 *
 * Порядок блоков фиксирован документ-моделью: вердикт → кого ищем → откуда берём →
 * гипотезы → строки запросов → версии.
 */
import type { SearchMapDocument, DocHypothesis } from './documentModel'
import { factsLine } from './documentModel'

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmtDate = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

function scoreDots(v: number | null): string {
  if (!v) return '—'
  return '●'.repeat(Math.min(3, v)) + '○'.repeat(Math.max(0, 3 - v))
}

function hypothesisRow(h: DocHypothesis): string {
  return `<tr>
    <td><strong>${esc(h.name)}</strong>${h.isAi ? ' <span class="tag">ИИ</span>' : ''}${h.subtitle ? `<div class="sub">${esc(h.subtitle)}</div>` : ''}${h.rationale ? `<div class="sub muted">${esc(h.rationale)}</div>` : ''}</td>
    <td>${esc(h.layerLabel)}</td>
    <td>${esc(h.channelName)}</td>
    <td class="nowrap">${esc(h.priorityLabel)}</td>
    <td class="nowrap scores">пул ${scoreDots(h.scores.pool)}<br>отклик ${scoreDots(h.scores.response)}<br>доступ ${scoreDots(h.scores.access)}</td>
    <td class="nowrap"><span class="st st-${esc(h.status)}">${esc(h.statusLabel)}</span>${h.hhSearchesCount ? `<div class="sub">hh-поисков: ${h.hhSearchesCount}</div>` : ''}${h.resultNote ? `<div class="sub muted">${esc(h.resultNote)}</div>` : ''}</td>
  </tr>`
}

export function renderDocumentHtml(doc: SearchMapDocument, opts: { autoPrint?: boolean } = {}): string {
  const f = doc.facts
  const sectionsHtml = doc.sections.filter(s => s.items.length || s.isRequired).map(s => `
    <section class="block">
      <h3>${esc(s.title)}${s.isRequired && !s.items.length ? ' <span class="warn">не заполнено</span>' : ''}</h3>
      ${s.items.length
        ? `<ul>${s.items.map(i => `<li>${esc(i.value)}${i.note ? ` <span class="muted">— ${esc(i.note)}</span>` : ''}${i.isAi ? ' <span class="tag">ИИ</span>' : ''}</li>`).join('')}</ul>`
        : `<p class="muted">${esc(s.guidance ?? 'Пока пусто')}</p>`}
    </section>`).join('')

  const donorsHtml = doc.donorLayers.map(l => `
    <section class="block">
      <h3>${esc(l.label)} <span class="muted small">· ${l.donors.length} · ${esc(l.hint)}</span></h3>
      <table>
        <tr><th>Компания</th><th>Приоритет</th><th>Статус</th><th>Почему оттуда</th><th>Результат</th></tr>
        ${l.donors.map(d => `<tr>
          <td><strong>${esc(d.name)}</strong>${d.isAi ? ' <span class="tag">ИИ</span>' : ''}${d.industry ? `<div class="sub">${esc(d.industry)}</div>` : ''}</td>
          <td class="nowrap">${esc(d.priorityLabel)}</td>
          <td class="nowrap"><span class="st st-${esc(d.status)}">${esc(d.statusLabel)}</span></td>
          <td>${esc(d.rationale ?? '')}</td>
          <td>${esc(d.resultNote ?? '')}</td>
        </tr>`).join('')}
      </table>
    </section>`).join('')

  const hypothesesHtml = doc.hypotheses.length
    ? `<table>
        <tr><th>Гипотеза</th><th>Слой</th><th>Канал</th><th>Приоритет</th><th>Оценка</th><th>Статус</th></tr>
        ${doc.hypotheses.map(hypothesisRow).join('')}
      </table>`
    : '<p class="muted">Гипотез пока нет</p>'

  const queriesHtml = doc.queries.length
    ? doc.queries.map(q => `<div class="query"><div class="qname">${esc(q.name)} <span class="muted small">· ${esc(q.channelName)}</span></div><code>${esc(q.queryString)}</code>${q.queryUrl ? `<div class="sub"><a href="${esc(q.queryUrl)}">${esc(q.queryUrl)}</a></div>` : ''}</div>`).join('')
    : ''

  const versionsHtml = doc.versions.length
    ? `<ol class="versions">${doc.versions.map(v => `<li><strong>v${v.versionNo} · ${esc(v.label)}</strong>${v.isCurrent ? ' <span class="tag">текущая</span>' : ''} <span class="muted small">${fmtDate(v.createdAt)}${v.triggerLabel ? ` · ${esc(v.triggerLabel)}` : ''}</span>${v.comment ? `<div class="sub">${esc(v.comment)}</div>` : ''}${v.diffLine ? `<div class="sub muted">${esc(v.diffLine)}</div>` : ''}</li>`).join('')}</ol>`
    : ''

  const stale = doc.staleSources.length
    ? `<div class="stale">Источники изменились после последней правки карты: ${esc(doc.staleSources.map(s => ({ brief: 'бриф', criteria: 'критерии', description: 'описание' }[s] ?? s)).join(', '))}</div>`
    : ''

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${esc(doc.title)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 960px; margin: 0 auto; padding: 24px; color: #1f2430; font-size: 13px; line-height: 1.45; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e3e6ec; }
  h3 { font-size: 13px; margin: 14px 0 6px; }
  .meta, .muted { color: #6b7280; } .small { font-size: 11px; } .sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .facts { font-size: 12px; color: #4b5563; margin-bottom: 12px; }
  .verdict { background: #f6f7fb; border: 1px solid #e3e6ec; border-radius: 8px; padding: 12px 14px; font-size: 13px; white-space: pre-wrap; }
  .stale { border: 1px solid #f3d9a4; background: #fff8e8; color: #7a5a12; border-radius: 6px; padding: 8px 10px; font-size: 12px; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  th, td { border: 1px solid #e3e6ec; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f6f7fb; font-weight: 600; font-size: 11px; color: #4b5563; }
  .nowrap { white-space: nowrap; } .scores { font-size: 10px; color: #4b5563; letter-spacing: 1px; }
  ul { padding-left: 18px; margin: 4px 0; } li { margin: 2px 0; }
  .tag { display: inline-block; font-size: 9px; padding: 1px 5px; border-radius: 4px; background: #eef0ff; color: #4b55c7; vertical-align: middle; }
  .warn { font-size: 10px; color: #b45309; font-weight: normal; }
  .st { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #eef0f4; }
  .st-working { background: #e3f6ea; color: #15803d; } .st-in_progress { background: #e6f0ff; color: #1d4ed8; }
  .st-rejected { background: #fdecec; color: #b91c1c; } .st-untested { background: #eef0f4; color: #4b5563; }
  .query { margin: 8px 0; } .qname { font-weight: 600; font-size: 12px; }
  code { display: block; font-size: 11px; background: #f6f7fb; border: 1px solid #e3e6ec; border-radius: 6px; padding: 6px 8px; white-space: pre-wrap; word-break: break-word; margin-top: 3px; }
  .versions { padding-left: 18px; } .versions li { margin: 6px 0; }
  a { color: #1d4ed8; word-break: break-all; }
  @media print { body { max-width: none; padding: 0; } h2 { break-after: avoid; } table, .block, .query { break-inside: avoid; } }
</style>
</head>
<body${opts.autoPrint ? ' onload="window.print()"' : ''}>
<h1>${esc(doc.title)}</h1>
<div class="meta">${f.versionLabel ? `Версия ${esc(f.versionLabel)} · ` : ''}Дата: ${fmtDate(new Date())}${f.lastGeneratedAt ? ` · ИИ-дополнение ${fmtDate(f.lastGeneratedAt)}${f.lastGenerationModel ? ` (${esc(f.lastGenerationModel)})` : ''}` : ''}</div>
${stale}
<h2>Вердикт по рынку</h2>
${doc.summary ? `<div class="verdict">${esc(doc.summary)}</div>` : '<p class="muted">Вердикт ещё не сформулирован</p>'}
<div class="facts">${esc(factsLine(f))}</div>
<h2>Кого ищем</h2>
${sectionsHtml || '<p class="muted">Секции пусты</p>'}
<h2>Откуда берём: компании-доноры</h2>
${donorsHtml || '<p class="muted">Доноров пока нет</p>'}
<h2>Гипотезы поиска</h2>
<p class="muted small">Гипотеза = слой доноров × должности × гео × канал. Оценка 1–3: пул, вероятность отклика, лёгкость доступа.</p>
${hypothesesHtml}
${queriesHtml ? `<h2>Строки запросов</h2>${queriesHtml}` : ''}
${versionsHtml ? `<h2>Версии карты</h2>${versionsHtml}` : ''}
</body></html>`
}

export function renderDocumentMarkdown(doc: SearchMapDocument): string {
  const md = (s: string | null | undefined) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const lines: string[] = []
  const f = doc.facts

  lines.push(`# ${doc.title}`)
  lines.push(`${f.versionLabel ? `**Версия:** ${f.versionLabel} · ` : ''}**Дата:** ${fmtDate(new Date())}`)
  lines.push('')
  lines.push('## Вердикт по рынку')
  lines.push(doc.summary ?? '_Вердикт ещё не сформулирован_')
  lines.push('')
  lines.push(`_${factsLine(f)}_`)
  lines.push('')

  lines.push('## Кого ищем')
  for (const s of doc.sections) {
    if (!s.items.length && !s.isRequired) continue
    lines.push(`### ${s.title}`)
    if (!s.items.length) lines.push(`_${s.guidance ?? 'Пока пусто'}_`)
    for (const i of s.items) lines.push(`- ${md(i.value)}${i.note ? ` — ${md(i.note)}` : ''}${i.isAi ? ' `ИИ`' : ''}`)
    lines.push('')
  }

  lines.push('## Откуда берём: компании-доноры')
  for (const l of doc.donorLayers) {
    lines.push(`### ${l.label} · ${l.donors.length}`)
    lines.push('| Компания | Приоритет | Статус | Почему оттуда | Результат |')
    lines.push('|---|---|---|---|---|')
    for (const d of l.donors) lines.push(`| ${md(d.name)}${d.isAi ? ' `ИИ`' : ''} | ${d.priorityLabel} | ${d.statusLabel} | ${md(d.rationale)} | ${md(d.resultNote)} |`)
    lines.push('')
  }

  lines.push('## Гипотезы поиска')
  lines.push('| Гипотеза | Слой | Должности | Гео | Канал | Приоритет | Пул/Отклик/Доступ | Статус | hh |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const h of doc.hypotheses) {
    const sc = [h.scores.pool, h.scores.response, h.scores.access].map(v => v ?? '—').join('/')
    lines.push(`| ${md(h.name)}${h.isAi ? ' `ИИ`' : ''} | ${h.layerLabel} | ${md(h.titles.join(', '))} | ${md(h.geo.join(', '))} | ${md(h.channelName)} | ${h.priorityLabel} | ${sc} | ${h.statusLabel} | ${h.hhSearchesCount || ''} |`)
  }
  lines.push('')

  if (doc.queries.length) {
    lines.push('## Строки запросов')
    for (const q of doc.queries) {
      lines.push(`**${md(q.name)}** · ${md(q.channelName)}`)
      lines.push('```')
      lines.push(q.queryString)
      lines.push('```')
      if (q.queryUrl) lines.push(`<${q.queryUrl}>`)
      lines.push('')
    }
  }

  if (doc.versions.length) {
    lines.push('## Версии карты')
    for (const v of doc.versions) {
      lines.push(`- **v${v.versionNo} · ${md(v.label)}**${v.isCurrent ? ' (текущая)' : ''} — ${fmtDate(v.createdAt)}${v.triggerLabel ? `, ${v.triggerLabel}` : ''}${v.comment ? ` — ${md(v.comment)}` : ''}${v.diffLine ? ` _(${v.diffLine})_` : ''}`)
    }
  }

  return lines.join('\n')
}
