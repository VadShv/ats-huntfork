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
    // Sprint 3.2: ФИО 100*0.50 + ДР 100*0.20 = 70 баллов гарантировано
    expect(score).toBeGreaterThanOrEqual(70)
  })

  it('одинаковые ФИО, разные даты → попадает в зону ревью', () => {
    const { score } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1985-01-01' },
    )
    // Sprint 3.2: ФИО 100*0.50 + Город 100*0.15 = 65 баллов
    expect(score).toBeGreaterThanOrEqual(60)
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
    // ФИО 100 после транслита; город Moscow vs Москва — разные строки
    // Sprint 3.2: ФИО 50 + ДР 20 = 70 баллов
    expect(score).toBeGreaterThanOrEqual(65)
  })

  it('опечатка в одной букве фамилии → скор около automerge', () => {
    const { score } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
      { firstName: 'Иван', lastName: 'Петрав', city: 'Москва', dateOfBirth: '1990-05-15' },
    )
    // Sprint 3.2: ФИО ~93*0.50=47 + Город 15 + ДР 20 = ~82 → почти review
    expect(score).toBeGreaterThanOrEqual(75)
  })

  it('одинаковое ФИО, разные ДР и города → ниже порога ревью', () => {
    const { score } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
      { firstName: 'Иван', lastName: 'Петров', city: 'Сочи', dateOfBirth: '1980-01-01' },
    )
    // Sprint 3.2: ФИО ~50, дальше 0+0+0 → итого ~50 → ниже review (85)
    expect(score).toBeLessThan(FUZZY_REVIEW_THRESHOLD)
  })

  it('null поля обрабатываются без падений', () => {
    const { score } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: null, dateOfBirth: null },
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
    )
    // Sprint 3.2: ФИО 100*0.50 = 50, без подтверждения городом/ДР/employer
    expect(score).toBeGreaterThanOrEqual(45)
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
    expect(signals).toHaveProperty('employer')
  })

  // Sprint 3.2 (P2.1): 4-й сигнал — работодатель/образование
  it('совпадающий работодатель добавляет сигнал employer=100', () => {
    const { score, signals } = computePairScore(
      {
        firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15',
        organizations: ['ООО «Яндекс»', 'МГУ'],
      },
      {
        firstName: 'Иван', lastName: 'Петров', city: 'Казань', dateOfBirth: '1990-05-15',
        organizations: ['Яндекс', 'СПбГУ'],
      },
    )
    expect(signals.employer).toBe(100)
    // ФИО 50 + ДР 20 + employer 15 = 85+
    expect(score).toBeGreaterThanOrEqual(80)
  })

  it('разные работодатели → employer=0', () => {
    const { signals } = computePairScore(
      {
        firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15',
        organizations: ['КловерМедиа'],
      },
      {
        firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15',
        organizations: ['SAP'],
      },
    )
    expect(signals.employer).toBe(0)
  })

  it('пустые organizations → employer=0', () => {
    const { signals } = computePairScore(
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
      { firstName: 'Иван', lastName: 'Петров', city: 'Москва', dateOfBirth: '1990-05-15' },
    )
    expect(signals.employer).toBe(0)
  })
})
