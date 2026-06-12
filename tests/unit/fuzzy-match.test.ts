import { describe, expect, it } from 'vitest'
import {
  computePairScore,
  FUZZY_AUTOMERGE_THRESHOLD,
  FUZZY_REVIEW_THRESHOLD,
} from '../../server/utils/fuzzy/match'

// ─────────────────────────────────────────────────────────────────────────────
// computePairScore — взвешенный скор пары кандидатов 0..100
// Веса: ФИО=55, Город=20, ДР=25. Если ФИО < 60 → итог 0.
// ─────────────────────────────────────────────────────────────────────────────

describe('computePairScore', () => {
  it('полностью одинаковые кандидаты дают 100', () => {
    const a = {
      firstName: 'Иван',
      lastName: 'Петров',
      city: 'Москва',
      dateOfBirth: '1990-05-15',
    }
    const { score, signals } = computePairScore(a, a)
    expect(score).toBe(100)
    expect(signals.name).toBe(100)
    expect(signals.city).toBe(100)
    expect(signals.dob).toBe(100)
  })

  it('одинаковое ФИО+ДР, разные города → скор всё ещё высокий', () => {
    const { score } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
      { firstName: 'Иван', lastName: 'Петров', city: 'Казань', dateOfBirth: '1990-05-15' },
    )
    // ФИО 100*0.55 + ДР 100*0.25 = 80 баллов гарантировано
    expect(score).toBeGreaterThanOrEqual(80)
  })

  it('одинаковые ФИО, разные даты → попадает в зону ревью', () => {
    const { score } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1985-01-01' },
    )
    // ФИО 100*0.55 + Город 100*0.20 = 75 баллов
    expect(score).toBeGreaterThanOrEqual(70)
    expect(score).toBeLessThan(FUZZY_AUTOMERGE_THRESHOLD)
  })

  it('разные имена дают 0 (ФИО — обязательный сигнал)', () => {
    const { score, signals } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
      { firstName: 'Мария', lastName: 'Сидорова', city: 'Москва', dateOfBirth: '1990-05-15' },
    )
    expect(score).toBe(0)
    expect(signals.city).toBe(0)
    expect(signals.dob).toBe(0)
  })

  it('латиница vs кириллица одного человека → высокий скор', () => {
    const { score } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
      { firstName: 'Ivan', lastName: 'Petrov', city: 'Moscow', dateOfBirth: '1990-05-15' },
    )
    // ФИО 100 после транслита; город Moscow vs Москва — разные строки → низкий
    // Но ФИО+ДР = 55+25 = 80 → всё равно review-зона
    expect(score).toBeGreaterThanOrEqual(75)
  })

  it('опечатка в одной букве фамилии → скор около automerge', () => {
    const { score } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
      { firstName: 'Иван', lastName: 'Петрав', city: 'Москва', dateOfBirth: '1990-05-15' },
    )
    // ФИО ~93*0.55=51 + Город 20 + ДР 25 = ~96
    expect(score).toBeGreaterThanOrEqual(FUZZY_REVIEW_THRESHOLD)
  })

  it('одинаковое ФИО, разные ДР и города → ниже порога ревью', () => {
    const { score } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
      { firstName: 'Иван', lastName: 'Петров', city: 'Сочи', dateOfBirth: '1980-01-01' },
    )
    // ФИО 55, дальше 0+0 → итого 55 → ниже review (85)
    expect(score).toBeLessThan(FUZZY_REVIEW_THRESHOLD)
  })

  it('null поля обрабатываются без падений', () => {
    const { score } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: null, dateOfBirth: null },
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
    )
    // ФИО 100*0.55 = 55, без подтверждения городом или ДР
    expect(score).toBeGreaterThanOrEqual(50)
    expect(score).toBeLessThan(FUZZY_REVIEW_THRESHOLD)
  })

  it('пороги отражают ожидаемые значения', () => {
    expect(FUZZY_REVIEW_THRESHOLD).toBe(85)
    expect(FUZZY_AUTOMERGE_THRESHOLD).toBe(95)
    expect(FUZZY_AUTOMERGE_THRESHOLD).toBeGreaterThan(FUZZY_REVIEW_THRESHOLD)
  })

  it('signals возвращаются всегда (для отладки)', () => {
    const { signals } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
    )
    expect(signals).toHaveProperty('name')
    expect(signals).toHaveProperty('city')
    expect(signals).toHaveProperty('dob')
  })
})
