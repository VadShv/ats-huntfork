import { describe, it, expect } from 'vitest'
import {
  ALL_STAGE_TYPES,
  STAGE_TYPE_META,
  stageTypeToLegacyStatus,
  stageTypeToHhCollection,
  bucketForStageType,
  isTerminalStageType,
  LEGACY_STATUS_TO_TYPES,
  type PipelineStageType,
  type LegacyApplicationStatus,
} from '../../shared/pipeline-stage-meta'

/**
 * Инвариант-тест единого источника семантики этапов.
 *
 * Замораживает текущее поведение всех четырёх производных карт (legacy status,
 * hh collection, bucket, terminal) ДО и ПОСЛЕ рефактора STAGE_TYPE_META.
 * Любое случайное изменение семантики типа или пропуск нового типа — красный тест.
 */

// Ожидаемая семантика — snapshot текущего продакшн-поведения (до унификации).
const EXPECTED: Record<PipelineStageType, {
  legacyStatus: LegacyApplicationStatus | null
  hhCollection: string | null
  bucket: 'working' | 'rejected'
  isTerminal: boolean
}> = {
  new:        { legacyStatus: 'new',       hhCollection: null,                  bucket: 'working',  isTerminal: false },
  on_hold:    { legacyStatus: 'screening', hhCollection: 'consider',            bucket: 'working',  isTerminal: false },
  contact:    { legacyStatus: 'screening', hhCollection: 'phone_interview',     bucket: 'working',  isTerminal: false },
  screening:  { legacyStatus: 'screening', hhCollection: 'consider',            bucket: 'working',  isTerminal: false },
  assessment: { legacyStatus: 'screening', hhCollection: 'assessment',          bucket: 'working',  isTerminal: false },
  interview:  { legacyStatus: 'interview', hhCollection: 'interview',           bucket: 'working',  isTerminal: false },
  offer:      { legacyStatus: 'offer',     hhCollection: 'offer',               bucket: 'working',  isTerminal: false },
  hired:      { legacyStatus: 'hired',     hhCollection: 'hired',               bucket: 'working',  isTerminal: true },
  not_fit:    { legacyStatus: 'rejected',  hhCollection: 'discard_by_employer', bucket: 'rejected', isTerminal: true },
  withdrawn:  { legacyStatus: 'rejected',  hhCollection: 'discard_by_employer', bucket: 'rejected', isTerminal: true },
  no_show:    { legacyStatus: 'rejected',  hhCollection: 'discard_by_employer', bucket: 'rejected', isTerminal: true },
  job_closed: { legacyStatus: 'rejected',  hhCollection: 'discard_by_employer', bucket: 'rejected', isTerminal: true },
  transferred:{ legacyStatus: 'rejected',  hhCollection: null,                  bucket: 'rejected', isTerminal: true },
  applied:    { legacyStatus: 'new',       hhCollection: null,                  bucket: 'working',  isTerminal: false },
  rejected:   { legacyStatus: 'rejected',  hhCollection: 'discard_by_employer', bucket: 'rejected', isTerminal: true },
  custom:     { legacyStatus: null,        hhCollection: null,                  bucket: 'working',  isTerminal: false },
}

describe('STAGE_TYPE_META — единый источник семантики этапов', () => {
  it('каждый enum-тип покрыт в META (нет тихих пропусков)', () => {
    for (const type of ALL_STAGE_TYPES) {
      expect(STAGE_TYPE_META[type], `META отсутствует для типа ${type}`).toBeDefined()
    }
    // и наоборот — в META нет лишних ключей
    expect(Object.keys(STAGE_TYPE_META).sort()).toEqual([...ALL_STAGE_TYPES].sort())
  })

  it.each(ALL_STAGE_TYPES)('семантика типа "%s" не изменилась', (type) => {
    const exp = EXPECTED[type]
    expect(stageTypeToLegacyStatus(type)).toBe(exp.legacyStatus)
    expect(stageTypeToHhCollection(type)).toBe(exp.hhCollection)
    expect(bucketForStageType(type)).toBe(exp.bucket)
    expect(isTerminalStageType(type)).toBe(exp.isTerminal)
  })

  it('намеренные асимметрии сохранены', () => {
    // transferred: legacy=rejected, но hh=null (перевод — не отказ на hh)
    expect(stageTypeToLegacyStatus('transferred')).toBe('rejected')
    expect(stageTypeToHhCollection('transferred')).toBeNull()

    // hired: bucket=working, но terminal + success
    expect(bucketForStageType('hired')).toBe('working')
    expect(isTerminalStageType('hired')).toBe(true)
    expect(STAGE_TYPE_META.hired.isSuccess).toBe(true)

    // on_hold/contact/assessment: один legacy-статус, разные hh-коллекции
    expect(stageTypeToLegacyStatus('on_hold')).toBe('screening')
    expect(stageTypeToLegacyStatus('contact')).toBe('screening')
    expect(stageTypeToLegacyStatus('assessment')).toBe('screening')
    expect(new Set([
      stageTypeToHhCollection('on_hold'),
      stageTypeToHhCollection('contact'),
      stageTypeToHhCollection('assessment'),
    ]).size).toBe(3)

    // custom: статус замирает, push не идёт
    expect(stageTypeToLegacyStatus('custom')).toBeNull()
    expect(stageTypeToHhCollection('custom')).toBeNull()
  })

  it('LEGACY_STATUS_TO_TYPES — корректная инверсия legacyStatus', () => {
    // Каждый тип с непустым legacyStatus присутствует ровно в своей корзине
    for (const type of ALL_STAGE_TYPES) {
      const ls = STAGE_TYPE_META[type].legacyStatus
      if (ls) expect(LEGACY_STATUS_TO_TYPES[ls]).toContain(type)
    }
    // Точный snapshot корзин (back-compat старых ?status=)
    expect([...LEGACY_STATUS_TO_TYPES.new].sort()).toEqual(['applied', 'new'])
    expect([...LEGACY_STATUS_TO_TYPES.screening].sort()).toEqual(['assessment', 'contact', 'on_hold', 'screening'])
    expect(LEGACY_STATUS_TO_TYPES.interview).toEqual(['interview'])
    expect(LEGACY_STATUS_TO_TYPES.offer).toEqual(['offer'])
    expect(LEGACY_STATUS_TO_TYPES.hired).toEqual(['hired'])
    expect([...LEGACY_STATUS_TO_TYPES.rejected].sort()).toEqual(
      ['job_closed', 'no_show', 'not_fit', 'rejected', 'transferred', 'withdrawn'],
    )
  })

  it('bucket и terminal согласованы: все rejected-типы терминальны', () => {
    for (const type of ALL_STAGE_TYPES) {
      const m = STAGE_TYPE_META[type]
      if (m.bucket === 'rejected') expect(m.isTerminal, `${type} должен быть терминальным`).toBe(true)
      if (m.isSuccess) expect(type).toBe('hired')
    }
  })
})
