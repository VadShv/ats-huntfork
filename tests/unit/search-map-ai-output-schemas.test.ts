/**
 * Схемы ответа модели для карты поиска должны переживать типовые отклонения
 * GLM/Qwen/YandexGPT от канонической формы — вместо «модель вернула ответ не по схеме».
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  sectionsOutputSchema, donorsOutputSchema, segmentsOutputSchema, summaryOutputSchema, queryOutputSchema, WRAP_BARE_ARRAY,
} from '../../server/utils/searchMap/aiOutputSchemas'
import { extractJsonPayload } from '../../server/utils/ai/provider'
import { buildGeneratePrompt, responseShape } from '../../server/utils/searchMap/buildGeneratePrompt'

describe('sectionsOutputSchema', () => {
  it('каноническая форма проходит без изменений', () => {
    const r = sectionsOutputSchema.parse({
      summary: 'Вердикт',
      sections: [{ sectionType: 'keywords', title: null, items: [{ value: 'Python', note: 'must-have' }] }],
    })
    expect(r.summary).toBe('Вердикт')
    expect(r.sections[0]!.items[0]).toEqual({ value: 'Python', note: 'must-have' })
  })

  it('пункты строками → { value } (главный сценарий ошибки «Секции: не по схеме»)', () => {
    const r = sectionsOutputSchema.parse({ summary: 'ok', sections: [{ sectionType: 'keywords', items: ['Python', 'SQL'] }] })
    expect(r.sections[0]!.items.map(i => i.value)).toEqual(['Python', 'SQL'])
    expect(r.sections[0]!.items[0]!.note ?? null).toBeNull()
  })

  it('секции объектом по ключам-типам → массив секций', () => {
    const r = sectionsOutputSchema.parse({ summary: 's', sections: { title_synonyms: ['Data Engineer'], keywords: [{ value: 'Spark' }] } })
    expect(r.sections.map(s => s.sectionType).sort()).toEqual(['keywords', 'title_synonyms'])
  })

  it('секции прямо в корне без ключа sections', () => {
    const r = sectionsOutputSchema.parse({ summary: 's', title_synonyms: ['Инженер данных'], geo: ['Москва'] })
    expect(r.sections).toHaveLength(2)
    expect(r.summary).toBe('s')
  })

  it('обёртка { result: {...} } снимается', () => {
    const r = sectionsOutputSchema.parse({ result: { sections: [{ sectionType: 'notes', items: ['Senior'] }] } })
    expect(r.sections[0]!.sectionType).toBe('notes')
  })

  it('голый массив секций через wrapBareArray + extractJsonPayload', () => {
    const raw = '```json\n[{"sectionType":"geo","items":["Москва","Санкт-Петербург"]}]\n```'
    const repaired = extractJsonPayload(raw, WRAP_BARE_ARRAY.sections)
    expect(repaired).not.toBeNull()
    const r = sectionsOutputSchema.parse(JSON.parse(repaired!))
    expect(r.sections[0]!.items).toHaveLength(2)
  })

  it('совсем не то — всё ещё ошибка, а не тихий успех', () => {
    expect(sectionsOutputSchema.safeParse('просто текст').success).toBe(false)
    expect(sectionsOutputSchema.safeParse(42).success).toBe(false)
  })

  it('альтернативные имена полей секции (type / values)', () => {
    const r = sectionsOutputSchema.parse({ sections: [{ type: 'exclusions', values: [{ text: 'Сбер', comment: 'non-poach' }] }] })
    expect(r.sections[0]!.sectionType).toBe('exclusions')
    expect(r.sections[0]!.items[0]).toEqual({ value: 'Сбер', note: 'non-poach' })
  })
})

describe('donorsOutputSchema / segmentsOutputSchema', () => {
  it('переименованный корневой ключ не превращается в пустой успех', () => {
    const d = donorsOutputSchema.parse({ companies: [{ name: 'Яндекс', layer: 'core', priority: 'P1' }] })
    expect(d.donors).toHaveLength(1)
    const s = segmentsOutputSchema.parse({ hypotheses: [{ name: 'Core hh', donorLayer: 'core', titles: 'Data Engineer, Инженер данных', channel: 'hh' }] })
    expect(s.segments[0]!.titles).toEqual(['Data Engineer', 'Инженер данных'])
    expect(s.segments[0]!.channelCode).toBe('hh')
  })

  it('голые массивы доноров и гипотез', () => {
    expect(donorsOutputSchema.parse([{ name: 'Ozon' }]).donors[0]!.name).toBe('Ozon')
    expect(segmentsOutputSchema.parse([{ name: 'X', titles: ['A'] }]).segments[0]!.name).toBe('X')
  })

  it('доноры строками', () => {
    expect(donorsOutputSchema.parse({ donors: ['Avito', 'Ozon'] }).donors.map(d => d.name)).toEqual(['Avito', 'Ozon'])
  })

  it('отсутствие корневого ключа и массивов — пустой список, а не исключение', () => {
    expect(donorsOutputSchema.parse({ something: 1 }).donors).toEqual([])
    expect(segmentsOutputSchema.parse({}).segments).toEqual([])
  })
})

describe('summaryOutputSchema / queryOutputSchema', () => {
  it('строка вместо объекта и синонимы ключей', () => {
    expect(summaryOutputSchema.parse('Вердикт').summary).toBe('Вердикт')
    expect(summaryOutputSchema.parse({ verdict: 'V' }).summary).toBe('V')
    expect(summaryOutputSchema.safeParse({}).success).toBe(false)
    expect(queryOutputSchema.parse({ query: '(a OR b)' }).queryString).toBe('(a OR b)')
    expect(queryOutputSchema.parse('(a)').queryString).toBe('(a)')
  })
})

describe('JSON Schema для модели', () => {
  it('preprocess не ломает схему, которую видит модель: внутри — канонический объект', () => {
    const js = z.toJSONSchema(sectionsOutputSchema, { target: 'draft-7', io: 'input' }) as any
    expect(js.type).toBe('object')
    expect(js.properties.sections.type).toBe('array')
    expect(js.properties.sections.items.properties.items.items.properties.value.type).toBe('string')
    const jd = z.toJSONSchema(donorsOutputSchema, { target: 'draft-7', io: 'input' }) as any
    expect(jd.properties.donors.items.required).toContain('name')
  })
})

describe('buildGeneratePrompt — форма ответа описана текстом', () => {
  it.each(['sections', 'donors', 'segments', 'summary', 'query_string'] as const)('часть %s содержит корневой ключ', (part) => {
    const { prompt } = buildGeneratePrompt({
      part, jobTitle: 'Data Engineer',
      targetSegment: part === 'query_string' ? { name: 'x', titles: [], keywords: [], geo: [] } : null,
    })
    expect(prompt).toContain('Формат ответа')
    expect(prompt).toContain(responseShape(part))
  })

  it('секции: объяснено, что пункт — объект с value', () => {
    expect(responseShape('sections')).toMatch(/"sections"/)
    expect(responseShape('sections')).toMatch(/"value"/)
    expect(responseShape('donors')).toMatch(/"donors"/)
    expect(responseShape('segments')).toMatch(/"segments"/)
  })
})
