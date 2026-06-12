import { describe, expect, it } from 'vitest'
import {
  citySimilarity,
  dobSimilarity,
  levenshteinSimilarity,
  nameSimilarity,
  normalizeCity,
  normalizeName,
} from '../../server/utils/fuzzy/normalize'

// ─────────────────────────────────────────────────────────────────────────────
// normalizeName — ё→е, lowercase, транслит латиницы
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeName', () => {
  it('приводит ё к е', () => {
    expect(normalizeName('Алёша')).toBe('алеша')
  })

  it('убирает лишние пробелы', () => {
    expect(normalizeName('  Иван   Петров  ')).toBe('иван петров')
  })

  it('транслитерирует чистую латиницу в кириллицу', () => {
    expect(normalizeName('Ivan Petrov')).toBe('иван петров')
  })

  it('не транслитерирует смешанную латиницу+цифры', () => {
    expect(normalizeName('Ivan 2')).toBe('ivan 2')
  })

  it('возвращает пустую строку для пустого ввода', () => {
    expect(normalizeName('')).toBe('')
    expect(normalizeName(null)).toBe('')
    expect(normalizeName(undefined)).toBe('')
  })

  it('убирает дефисы и апострофы', () => {
    expect(normalizeName('Анна-Мария')).toBe('анна мария')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// normalizeCity — убираем «г.», «город», скобки
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCity', () => {
  it('убирает префикс г.', () => {
    expect(normalizeCity('г. Москва')).toBe('москва')
    expect(normalizeCity('г.Москва')).toBe('москва')
  })

  it('убирает слово город', () => {
    expect(normalizeCity('город Москва')).toBe('москва')
  })

  it('убирает скобки с регионом', () => {
    expect(normalizeCity('Москва (Московская область)')).toBe('москва')
  })

  it('НЕ съедает «город» внутри названия (Новгород остаётся)', () => {
    expect(normalizeCity('Нижний Новгород')).toBe('нижний новгород')
  })

  it('убирает «г» без точки в начале', () => {
    expect(normalizeCity('г Москва')).toBe('москва')
  })

  it('приводит ё к е', () => {
    expect(normalizeCity('Орёл')).toBe('орел')
  })

  it('возвращает пустую строку для пустого', () => {
    expect(normalizeCity('')).toBe('')
    expect(normalizeCity(null)).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// levenshteinSimilarity — 0..100
// ─────────────────────────────────────────────────────────────────────────────

describe('levenshteinSimilarity', () => {
  it('идентичные строки дают 100', () => {
    expect(levenshteinSimilarity('abc', 'abc')).toBe(100)
  })

  it('пустые с обеих сторон дают 100', () => {
    expect(levenshteinSimilarity('', '')).toBe(100)
  })

  it('одна пустая даёт 0', () => {
    expect(levenshteinSimilarity('abc', '')).toBe(0)
    expect(levenshteinSimilarity('', 'abc')).toBe(0)
  })

  it('сильно разные длины дают 0 (быстрый отказ)', () => {
    expect(levenshteinSimilarity('a', 'abcdefghij')).toBe(0)
  })

  it('один символ разницы из 4 даёт 75', () => {
    expect(levenshteinSimilarity('abcd', 'abce')).toBe(75)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// nameSimilarity — устойчив к порядку токенов
// ─────────────────────────────────────────────────────────────────────────────

describe('nameSimilarity', () => {
  it('одинаковые ФИО дают 100', () => {
    expect(nameSimilarity('Иван Петров', 'Иван Петров')).toBe(100)
  })

  it('порядок токенов не важен (Петров Иван = Иван Петров)', () => {
    expect(nameSimilarity('Петров Иван', 'Иван Петров')).toBe(100)
  })

  it('латиница и кириллица одного человека дают 100', () => {
    expect(nameSimilarity('Ivan Petrov', 'Иван Петров')).toBe(100)
  })

  it('одна буква разницы в фамилии понижает скор, но остаётся высоким', () => {
    const s = nameSimilarity('Иван Петров', 'Иван Петрав')
    expect(s).toBeGreaterThan(80)
    expect(s).toBeLessThan(100)
  })

  it('совсем разные имена дают низкий скор', () => {
    expect(nameSimilarity('Иван Петров', 'Мария Сидорова')).toBeLessThan(50)
  })

  it('null/пустые дают 0', () => {
    expect(nameSimilarity(null, 'Иван')).toBe(0)
    expect(nameSimilarity('Иван', '')).toBe(0)
  })

  it('ё/е считаются одинаковыми', () => {
    expect(nameSimilarity('Алёша Попов', 'Алеша Попов')).toBe(100)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// citySimilarity
// ─────────────────────────────────────────────────────────────────────────────

describe('citySimilarity', () => {
  it('Москва = Москва → 100', () => {
    expect(citySimilarity('Москва', 'Москва')).toBe(100)
  })

  it('«г. Москва» = «Москва» → 100', () => {
    expect(citySimilarity('г. Москва', 'Москва')).toBe(100)
  })

  it('Москва ≠ Санкт-Петербург → низкий скор', () => {
    expect(citySimilarity('Москва', 'Санкт-Петербург')).toBeLessThan(50)
  })

  it('null даёт 0', () => {
    expect(citySimilarity(null, 'Москва')).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// dobSimilarity — бинарный сигнал
// ─────────────────────────────────────────────────────────────────────────────

describe('dobSimilarity', () => {
  it('одинаковые даты дают 100', () => {
    expect(dobSimilarity('1990-05-15', '1990-05-15')).toBe(100)
  })

  it('разные даты дают 0 (без fuzzy)', () => {
    expect(dobSimilarity('1990-05-15', '1990-05-16')).toBe(0)
  })

  it('одна null даёт 0', () => {
    expect(dobSimilarity(null, '1990-05-15')).toBe(0)
    expect(dobSimilarity('1990-05-15', null)).toBe(0)
  })

  it('Date объект и ISO-строка той же даты — 100', () => {
    const d = new Date('1990-05-15T00:00:00Z')
    expect(dobSimilarity(d, '1990-05-15')).toBe(100)
  })

  it('игнорирует время в ISO-строке (берёт только дату)', () => {
    expect(dobSimilarity('1990-05-15T12:30:00Z', '1990-05-15')).toBe(100)
  })
})
