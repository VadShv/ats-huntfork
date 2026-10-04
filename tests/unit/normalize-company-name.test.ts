import { describe, it, expect } from 'vitest'
import { normalizeCompanyName } from '../../server/utils/searchMap/normalizeCompanyName'

describe('normalizeCompanyName', () => {
  const cases: [string, string][] = [
    ['ООО «Яндекс»', 'яндекс'],
    ['Yandex LLC', 'yandex'],
    ['T-Bank', 't-bank'],
    ['ООО "Сбер Технологии"', 'сбер технологии'],
    ['  Сбер  ', 'сбер'],
    ['Сбербанк', 'сбербанк'],
    ['ОАО «Газпром»', 'газпром'],
    ['IP Иванов И.И.', 'иванов и.и.'],
    ['NKO "Фонд А"', 'фонд а'],
    ['Microsoft Corp.', 'microsoft'],
    ['Amazon.com, Inc', 'amazon.com'],
    ['ООО «ЯНДЕКС»', 'яндекс'],
    ['Yandex', 'yandex'],
    ['Tinkoff Bank', 'tinkoff bank'],
    ['АО «НПО Высокие Технологии»', 'нпо высокие технологии'],
    ['Google Holding', 'google'],
    ['VK Group', 'vk'],
    ['Luxoft GmbH', 'luxoft'],
    ['EPAM Systems Inc', 'epam systems'],
    ['К&М', 'к&м'],
  ]

  it.each(cases)('normalizeCompanyName(%j) → %j', (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected)
  })

  it('Сбер ≠ Сбербанк (no stemming)', () => {
    expect(normalizeCompanyName('Сбер')).not.toBe(normalizeCompanyName('Сбербанк'))
  })

  it('ё → е', () => {
    expect(normalizeCompanyName('Алёша')).toBe('алеша')
  })

  it('empty string', () => {
    expect(normalizeCompanyName('')).toBe('')
  })

  it('collapses multiple spaces', () => {
    expect(normalizeCompanyName('ООО   Яandex')).toBe('яandex')
  })

  it('preserves hyphens and dots', () => {
    expect(normalizeCompanyName('T-Bank')).toBe('t-bank')
    expect(normalizeCompanyName('v2.0')).toBe('v2.0')
  })
})
