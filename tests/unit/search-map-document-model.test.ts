import { describe, it, expect } from 'vitest'
import {
  buildSearchMapDocument, factsLine, versionDiffLine, hypothesisSubtitle, sortHypotheses, plural,
} from '../../shared/searchMap/documentModel'
import { renderDocumentHtml, renderDocumentMarkdown } from '../../shared/searchMap/renderDocument'

const input = {
  jobTitle: 'Менеджер МСФО',
  map: { summary: 'Рынок узкий, искать среди alumni Big 4.', currentVersionNo: 2, lastGeneratedAt: '2026-10-01T10:00:00Z', lastGenerationModel: 'gpt-x' },
  sections: [
    { id: 's1', sectionType: 'title_synonyms', title: 'Синонимы должности', isRequired: true, displayOrder: 1, items: [{ id: 'i1', value: 'IFRS Manager', origin: 'ai' }, { id: 'i2', value: 'Менеджер МСФО', origin: 'manual', note: 'основной' }] },
    { id: 's2', sectionType: 'exclusions', title: 'Исключения', isRequired: false, displayOrder: 0, items: [] },
    { id: 's3', sectionType: 'keywords', title: 'Ключевые слова', isRequired: true, displayOrder: 2, items: [] },
  ],
  donors: [
    { donor: { id: 'd1', layer: 'core', priority: 'medium', hypothesisStatus: 'untested', origin: 'ai', displayOrder: 0 }, company: { id: 'c1', canonicalName: 'Kept' } },
    { donor: { id: 'd2', layer: 'core', priority: 'high', hypothesisStatus: 'working', origin: 'manual', displayOrder: 1, rationale: 'Оттуда пришли двое' }, company: { id: 'c2', canonicalName: 'Б1', industry: 'Аудит' } },
    { donor: { id: 'd3', layer: 'alumni', priority: 'low', hypothesisStatus: 'rejected', origin: 'manual', displayOrder: 2 }, company: { id: 'c3', canonicalName: 'Технологии Доверия' } },
  ],
  segments: [
    { segment: { id: 'g1', name: 'Г1', donorLayer: 'core', titles: ['IFRS Manager', 'Менеджер МСФО', 'Главбух МСФО', 'Ещё'], geo: ['Москва', 'СПб'], priority: 'medium', hypothesisStatus: 'untested', queryString: 'A AND B', queryUrl: 'https://hh.ru/x', origin: 'ai', displayOrder: 0, poolEstimate: 2 }, channel: { id: 'ch1', code: 'hh', name: 'hh.ru' }, hhSearchesCount: 1 },
    { segment: { id: 'g2', name: 'Г2', donorLayer: 'alumni', titles: ['IFRS Manager'], geo: [], priority: 'high', hypothesisStatus: 'working', queryString: null, origin: 'manual', displayOrder: 1 }, channel: { id: 'ch2', code: 'linkedin', name: 'LinkedIn' }, hhSearchesCount: 0 },
    { segment: { id: 'g3', name: 'Архив', priority: 'high', hypothesisStatus: 'working', isArchived: true, origin: 'manual', displayOrder: 2 }, channel: null, hhSearchesCount: 0 },
  ],
  versions: [
    { id: 'v1', versionNo: 1, label: 'Старт', trigger: 'manual', createdAt: '2026-09-01T00:00:00Z' },
    { id: 'v2', versionNo: 2, label: 'После калибровки', trigger: 'calibration', comment: 'Убрали 1С', createdAt: '2026-09-10T00:00:00Z', diffSummary: { sections: [{ title: 'x', added: ['a', 'b'], removed: [] }], donors: { added: [1], removed: [], changed: [] }, segments: { added: [], removed: [1, 2], changed: [] } } },
  ],
  staleSources: ['brief'],
}

describe('buildSearchMapDocument', () => {
  const doc = buildSearchMapDocument(input as any)

  it('факты: архивные гипотезы не считаются, обязательные секции посчитаны', () => {
    expect(doc.facts.hypothesesTotal).toBe(2)
    expect(doc.facts.hypothesesByStatus.working).toBe(1)
    expect(doc.facts.hypothesesByStatus.untested).toBe(1)
    expect(doc.facts.donorsTotal).toBe(3)
    expect(doc.facts.donorsWorking).toBe(1)
    expect(doc.facts.hhSearchesTotal).toBe(1)
    expect(doc.facts.requiredSectionsFilled).toBe(1)
    expect(doc.facts.requiredSectionsTotal).toBe(2)
    expect(doc.facts.aiItemsShare).toBe(50)
    expect(doc.facts.versionLabel).toBe('v2')
    expect(factsLine(doc.facts)).toBe('2 гипотезы · 1 работает · 1 не проверена · 3 донора · 1 hh-поиск · обязательные секции 1/2')
  })

  it('секции отсортированы по displayOrder, пункты помечены ИИ', () => {
    expect(doc.sections.map(s => s.sectionType)).toEqual(['exclusions', 'title_synonyms', 'keywords'])
    expect(doc.sections[1]!.items[0]!.isAi).toBe(true)
    expect(doc.sections[1]!.items[1]!.note).toBe('основной')
  })

  it('слои доноров: только непустые, в порядке core→alumni, внутри — по приоритету', () => {
    expect(doc.donorLayers.map(l => l.key)).toEqual(['core', 'alumni'])
    expect(doc.donorLayers[0]!.donors.map(d => d.name)).toEqual(['Б1', 'Kept'])
    expect(doc.donorLayers[0]!.donors[0]!.statusLabel).toBe('Работает')
  })

  it('гипотезы: сортировка по приоритету, подзаголовок «тайтлы · гео», канал подписан', () => {
    expect(doc.hypotheses.map(h => h.name)).toEqual(['Г2', 'Г1'])
    const g1 = doc.hypotheses[1]!
    expect(g1.subtitle).toContain('IFRS Manager, Менеджер МСФО, Главбух МСФО')
    expect(g1.subtitle).toContain('+1')
    expect(g1.subtitle).toContain('Москва, СПб')
    expect(g1.channelName).toBe('hh.ru')
    expect(g1.layerLabel).toBe('Ядро')
    expect(g1.priorityLabel).toBe('Средний')
    expect(g1.hhSearchesCount).toBe(1)
    expect(g1.scores.pool).toBe(2)
  })

  it('строки запросов — только у гипотез с queryString', () => {
    expect(doc.queries).toHaveLength(1)
    expect(doc.queries[0]).toMatchObject({ name: 'Г1', queryString: 'A AND B', queryUrl: 'https://hh.ru/x' })
  })

  it('версии — новые сверху, текущая помечена, diff собран в строку', () => {
    expect(doc.versions.map(v => v.versionNo)).toEqual([2, 1])
    expect(doc.versions[0]!.isCurrent).toBe(true)
    expect(doc.versions[0]!.triggerLabel).toBe('калибровка с HM')
    expect(doc.versions[0]!.diffLine).toBe('+2 пункта · +1 донор · −2 гипотезы')
    expect(doc.versions[1]!.diffLine).toBeNull()
  })

  it('stale-источники прокинуты', () => {
    expect(doc.staleSources).toEqual(['brief'])
  })
})

describe('renderDocumentHtml / Markdown', () => {
  const doc = buildSearchMapDocument(input as any)

  it('HTML содержит все блоки в нужном порядке и экранирует разметку', () => {
    const html = renderDocumentHtml({ ...doc, summary: '<script>x</script>' }, { autoPrint: true })
    const order = ['Вердикт по рынку', 'Кого ищем', 'Откуда берём', 'Гипотезы поиска', 'Строки запросов', 'Версии карты']
    const idx = order.map(h => html.indexOf(h))
    expect(idx.every(i => i > 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>x')
    expect(html).toContain('onload="window.print()"')
    expect(html).toContain('@media print')
    expect(html).toContain('Источники изменились')
  })

  it('без autoPrint нет onload', () => {
    expect(renderDocumentHtml(doc)).not.toContain('onload=')
  })

  it('Markdown содержит таблицу гипотез и код запроса', () => {
    const md = renderDocumentMarkdown(doc)
    expect(md).toContain('# Карта поиска: Менеджер МСФО')
    expect(md).toContain('| Г2 | Alumni |')
    expect(md).toContain('```\nA AND B\n```')
    expect(md).toContain('- **v2 · После калибровки** (текущая)')
  })
})

describe('helpers', () => {
  it('hypothesisSubtitle без данных → пусто', () => {
    expect(hypothesisSubtitle({})).toBe('')
  })
  it('sortHypotheses стабилен', () => {
    const list = [{ priority: 'low', hypothesisStatus: 'untested', displayOrder: 0 }, { priority: 'high', hypothesisStatus: 'rejected', displayOrder: 1 }, { priority: 'high', hypothesisStatus: 'working', displayOrder: 2 }]
    expect(sortHypotheses(list).map(x => x.displayOrder)).toEqual([2, 1, 0])
  })
  it('plural', () => {
    expect(plural(1, 'а', 'б', 'в')).toBe('а'); expect(plural(3, 'а', 'б', 'в')).toBe('б'); expect(plural(11, 'а', 'б', 'в')).toBe('в'); expect(plural(25, 'а', 'б', 'в')).toBe('в')
  })
})
