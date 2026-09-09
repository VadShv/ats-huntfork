import { describe, it, expect } from 'vitest'
import {
  validatePipelineStages,
  canAddStageToPipeline,
  bucketForType,
  isTerminalTypeDefault,
  WORKING_TYPES,
  REJECTED_TYPES,
  type StageInput,
} from '../../server/utils/pipeline-validation'

/**
 * Юнит-тесты валидатора воронки и гвардов B1 (W3.4).
 */

describe('canAddStageToPipeline (B1)', () => {
  it('системная воронка: подэтап (parentStageId задан) — разрешён', () => {
    expect(canAddStageToPipeline(true, 'root-1').allowed).toBe(true)
  })
  it('системная воронка: корневой этап (parentStageId null) — запрещён', () => {
    const r = canAddStageToPipeline(true, null)
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/только подэтапы/i)
  })
  it('системная воронка: parentStageId undefined — запрещён', () => {
    expect(canAddStageToPipeline(true, undefined).allowed).toBe(false)
  })
  it('пользовательская (песочница): любой этап разрешён', () => {
    expect(canAddStageToPipeline(false, null).allowed).toBe(true)
    expect(canAddStageToPipeline(false, 'root-1').allowed).toBe(true)
  })
})

describe('bucketForType / isTerminalTypeDefault', () => {
  it('working-типы → working', () => {
    for (const t of WORKING_TYPES) expect(bucketForType(t)).toBe('working')
  })
  it('rejected-типы → rejected', () => {
    for (const t of REJECTED_TYPES) expect(bucketForType(t)).toBe('rejected')
  })
  it('custom → спец-значение "custom" (bucket задаётся в БД)', () => {
    expect(bucketForType('custom')).toBe('custom')
  })
  it('hired терминален, но new — нет', () => {
    expect(isTerminalTypeDefault('hired')).toBe(true)
    expect(isTerminalTypeDefault('not_fit')).toBe(true)
    expect(isTerminalTypeDefault('new')).toBe(false)
    expect(isTerminalTypeDefault('interview')).toBe(false)
  })
})

describe('validatePipelineStages', () => {
  const s = (o: Partial<StageInput> & { name: string; type: string }): StageInput => ({
    isTerminal: false, ...o,
  })

  const validSet: StageInput[] = [
    s({ id: 'a', name: 'Новые', type: 'new', bucket: 'working' }),
    s({ id: 'b', name: 'Интервью', type: 'interview', bucket: 'working' }),
    s({ id: 'c', name: 'Отказ', type: 'not_fit', bucket: 'rejected', isTerminal: true }),
  ]

  it('корректный набор проходит', () => {
    expect(() => validatePipelineStages(validSet)).not.toThrow()
  })

  it('меньше 2 working-этапов → ошибка', () => {
    expect(() => validatePipelineStages([
      s({ id: 'a', name: 'Новые', type: 'new', bucket: 'working' }),
      s({ id: 'c', name: 'Отказ', type: 'not_fit', bucket: 'rejected', isTerminal: true }),
    ])).toThrow(/минимум 2 активных этапа/i)
  })

  it('нет rejected-этапа → ошибка', () => {
    expect(() => validatePipelineStages([
      s({ id: 'a', name: 'Новые', type: 'new', bucket: 'working' }),
      s({ id: 'b', name: 'Интервью', type: 'interview', bucket: 'working' }),
    ])).toThrow(/минимум 1 этап отказа/i)
  })

  it('вложенность подэтапа глубже 1 уровня → ошибка', () => {
    expect(() => validatePipelineStages([
      ...validSet,
      s({ id: 'd', name: 'Звонок', type: 'contact', bucket: 'working', parentStageId: 'b' }),
      s({ id: 'e', name: 'Ещё раз', type: 'contact', bucket: 'working', parentStageId: 'd' }),
    ])).toThrow(/1 уровень вложенности/i)
  })

  it('дубликаты имён на одном уровне → ошибка', () => {
    expect(() => validatePipelineStages([
      s({ id: 'a', name: 'Новые', type: 'new', bucket: 'working' }),
      s({ id: 'b', name: 'Новые', type: 'interview', bucket: 'working' }),
      s({ id: 'c', name: 'Отказ', type: 'not_fit', bucket: 'rejected', isTerminal: true }),
    ])).toThrow(/одинаковым именем/i)
  })

  it('legacy-тип applied для НОВОГО этапа (без id) → ошибка', () => {
    expect(() => validatePipelineStages([
      ...validSet,
      s({ name: 'Старый', type: 'applied', bucket: 'working' }),
    ])).toThrow(/устаревш/i)
  })

  it('скрытые/архивные этапы не учитываются в required-проверках', () => {
    // Скрытый rejected не спасает от «нет rejected»
    expect(() => validatePipelineStages([
      s({ id: 'a', name: 'Новые', type: 'new', bucket: 'working' }),
      s({ id: 'b', name: 'Интервью', type: 'interview', bucket: 'working' }),
      s({ id: 'c', name: 'Отказ', type: 'not_fit', bucket: 'rejected', isTerminal: true, isHidden: true }),
    ])).toThrow(/минимум 1 этап отказа/i)
  })
})
