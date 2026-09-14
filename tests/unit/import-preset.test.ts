import { describe, it, expect } from 'vitest'
import { topicTypeToCategory, matchCriterion, buildImportRows, type PresetSectionForImport } from '../../server/utils/questions/importPreset'

describe('topicTypeToCategory', () => {
  it('маппит типы тем в категории вопросов', () => {
    expect(topicTypeToCategory('professional')).toBe('hard_skill')
    expect(topicTypeToCategory('management')).toBe('hard_skill')
    expect(topicTypeToCategory('soft_skill')).toBe('soft_skill')
    expect(topicTypeToCategory('achievement_scale')).toBe('experience')
    expect(topicTypeToCategory('motivation')).toBe('motivation')
    expect(topicTypeToCategory('value')).toBe('culture')
    expect(topicTypeToCategory('factcheck')).toBe('risk_probe')
    expect(topicTypeToCategory('risk_zone')).toBe('risk_probe')
    expect(topicTypeToCategory('custom')).toBe('other')
  })
})

describe('matchCriterion', () => {
  const criteria = [
    { id: 'c1', key: 'communication', name: 'Коммуникация' },
    { id: 'c2', key: null, name: 'Результативность' },
  ]
  it('матчит по нормализованному имени темы', () => {
    expect(matchCriterion({ name: 'Коммуникация', code: null }, criteria)).toBe('c1')
    expect(matchCriterion({ name: 'результативность', code: null }, criteria)).toBe('c2')
  })
  it('нет совпадения → null (дыра)', () => {
    expect(matchCriterion({ name: 'Лидерство', code: null }, criteria)).toBeNull()
  })
  it('пустая тема → null', () => {
    expect(matchCriterion({ name: null, code: null }, criteria)).toBeNull()
  })
})

describe('buildImportRows', () => {
  const sections: PresetSectionForImport[] = [
    {
      id: 's1', topicId: 't1', topicType: 'professional', topicName: 'Backend', topicCode: null,
      goal: 'Тех. навыки', displayOrder: 0,
      questions: [
        { bankQuestion: { id: 'q1', version: 1, text: 'Опыт с PostgreSQL?', goal: 'проверить БД', expectedSignal: 'детали', status: 'published' }, isRequired: true, displayOrder: 0 },
        { bankQuestion: { id: 'q2', version: 2, text: 'Опыт с Redis?', goal: null, expectedSignal: null, status: 'published' }, isRequired: false, displayOrder: 1 },
        { bankQuestion: { id: 'q3', version: 1, text: 'Черновик', goal: null, expectedSignal: null, status: 'draft' }, isRequired: false, displayOrder: 2 },
      ],
    },
  ]

  it('разворачивает только published, маппит поля', () => {
    const { rows, skippedDuplicates } = buildImportRows({
      presetId: 'p1', sections, criteria: [], existingNormalized: new Set(), startOrder: 0,
    })
    expect(rows).toHaveLength(2) // draft отфильтрован
    expect(rows[0]).toMatchObject({
      text: 'Опыт с PostgreSQL?', category: 'hard_skill', rationale: 'проверить БД',
      goodAnswer: 'детали', linkMode: 'linked', sourceBankQuestionId: 'q1', sourceVersion: 1,
      presetId: 'p1', sectionRef: 's1', displayOrder: 0,
    })
    // rationale fallback на goal раздела, если у вопроса пусто
    expect(rows[1].rationale).toBe('Тех. навыки')
    expect(rows[1].displayOrder).toBe(1)
    expect(skippedDuplicates).toBe(0)
  })

  it('дедуп против существующих', () => {
    const { rows, skippedDuplicates } = buildImportRows({
      presetId: 'p1', sections, criteria: [],
      existingNormalized: new Set(['опыт с postgresql']),
      startOrder: 5,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('Опыт с Redis?')
    expect(rows[0].displayOrder).toBe(5)
    expect(skippedDuplicates).toBe(1)
  })

  it('авто-матч критерия по теме', () => {
    const { rows } = buildImportRows({
      presetId: 'p1', sections, criteria: [{ id: 'cb', key: 'backend', name: 'Backend' }],
      existingNormalized: new Set(), startOrder: 0,
    })
    expect(rows[0].criterionId).toBe('cb')
  })
})
