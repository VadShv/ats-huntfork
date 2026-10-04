import PDFDocument from 'pdfkit'

/**
 * Export search map as PDF.
 * docs/tz-search-map.md §9.5
 */
export function exportPdf(opts: {
  jobTitle: string
  versionLabel?: string
  summary?: string | null
  sections: { title: string; items: { value: string; note?: string | null }[] }[]
  donors: { canonicalName: string; layer: string; priority: string; hypothesisStatus: string; rationale?: string | null }[]
  segments: { name: string; donorLayer?: string | null; titles: string[]; geo: string[]; channelCode?: string | null; queryString?: string | null; priority: string; hypothesisStatus: string }[]
}): Buffer {
  const doc = new PDFDocument({ margin: 50, size: 'A4' })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))

  const layerLabels: Record<string, string> = {
    core: 'Ядро', adjacent: 'Смежный', school: 'Школы', alumni: 'Alumni', custom: 'Своё',
  }
  const statusLabels: Record<string, string> = {
    untested: 'Не проверена', in_progress: 'В работе', working: 'Работает', rejected: 'Отклонена',
  }

  // Header
  doc.fontSize(18).font('Helvetica-Bold').text(`Карта поиска: ${opts.jobTitle}`, { width: 495 })
  doc.moveDown(0.3)
  const meta: string[] = []
  if (opts.versionLabel) meta.push(`Версия: ${opts.versionLabel}`)
  meta.push(`Дата: ${new Date().toLocaleDateString('ru-RU')}`)
  doc.fontSize(10).font('Helvetica').text(meta.join('   |   '))
  doc.moveDown()

  if (opts.summary) {
    doc.fontSize(10).font('Helvetica').text(opts.summary, { width: 495 })
    doc.moveDown()
  }

  // Sections
  doc.fontSize(14).font('Helvetica-Bold').text('Секции')
  doc.moveDown(0.3)
  for (const section of opts.sections) {
    doc.fontSize(11).font('Helvetica-Bold').text(section.title)
    doc.moveDown(0.1)
    for (const item of section.items) {
      const note = item.note ? ` — ${item.note}` : ''
      doc.fontSize(9).font('Helvetica').text(`•  ${item.value}${note}`, { width: 480 })
    }
    doc.moveDown(0.3)
  }
  doc.moveDown()

  // Donors
  doc.fontSize(14).font('Helvetica-Bold').text('Компании-доноры')
  doc.moveDown(0.3)
  drawTable(doc, ['Компания', 'Слой', 'Приоритет', 'Статус'], opts.donors.map(d => [
    d.canonicalName,
    layerLabels[d.layer] ?? d.layer,
    d.priority,
    statusLabels[d.hypothesisStatus] ?? d.hypothesisStatus,
  ]))
  doc.moveDown()

  // Segments
  doc.fontSize(14).font('Helvetica-Bold').text('Сегменты')
  doc.moveDown(0.3)
  drawTable(doc, ['Сегмент', 'Слой', 'Канал', 'Приоритет', 'Статус'], opts.segments.map(s => [
    s.name,
    s.donorLayer ? (layerLabels[s.donorLayer] ?? s.donorLayer) : '—',
    s.channelCode ?? '—',
    s.priority,
    statusLabels[s.hypothesisStatus] ?? s.hypothesisStatus,
  ]))

  // Query strings
  const segmentsWithQuery = opts.segments.filter(s => s.queryString)
  if (segmentsWithQuery.length) {
    doc.moveDown()
    doc.fontSize(14).font('Helvetica-Bold').text('Строки запросов')
    doc.moveDown(0.3)
    for (const s of segmentsWithQuery) {
      doc.fontSize(9).font('Helvetica-Bold').text(s.name)
      doc.fontSize(8).font('Helvetica').text(s.queryString!, { width: 480 })
      doc.moveDown(0.2)
    }
  }

  doc.end()

  return Buffer.concat(chunks)
}

function drawTable(doc: InstanceType<typeof PDFDocument>, headers: string[], rows: string[][]) {
  const colWidths = headers.map(() => 495 / headers.length)
  const startX = 50

  // Header row
  doc.fontSize(8).font('Helvetica-Bold')
  let x = startX
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x, doc.y, { width: colWidths[i] - 5 })
    x += colWidths[i]
  }
  doc.moveDown(0.2)
  doc.moveTo(startX, doc.y).lineTo(startX + 495, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke()
  doc.moveDown(0.2)

  // Data rows
  doc.font('Helvetica')
  for (const row of rows) {
    x = startX
    const startY = doc.y
    for (let i = 0; i < row.length; i++) {
      doc.text(row[i], x, startY, { width: colWidths[i] - 5, ellipsis: true })
      x += colWidths[i]
    }
    doc.moveDown(0.2)
    if (doc.y > 750) doc.addPage()
  }
}
