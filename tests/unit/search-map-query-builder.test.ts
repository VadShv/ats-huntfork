import { describe, it, expect } from 'vitest'
import { buildQueryString, detectQueryLanguage, usableExclusions, QUERY_LIMITS } from '../../shared/searchMap/queryBuilder'

const seg = { titles: ['Менеджер МСФО', 'IFRS Manager'], keywords: ['консолидация', 'IFRS 16'], geo: ['Москва'] }

describe('detectQueryLanguage', () => {
  it('канал с targetSite → xray', () => {
    expect(detectQueryLanguage({ code: 'google_xray_linkedin', targetSite: 'linkedin.com/in' })).toBe('xray')
  })
  it('hh / linkedin / github / habr → boolean', () => {
    for (const code of ['hh', 'linkedin', 'github', 'habr']) expect(detectQueryLanguage({ code })).toBe('boolean')
  })
  it('telegram / referral → plain; подсказка с AND/OR → boolean', () => {
    expect(detectQueryLanguage({ code: 'telegram' })).toBe('plain')
    expect(detectQueryLanguage({ code: 'referral' })).toBe('plain')
    expect(detectQueryLanguage({ code: 'custom', queryLanguageHint: 'Поддерживает AND, OR, NOT' })).toBe('boolean')
  })
  it('нет канала → boolean', () => {
    expect(detectQueryLanguage(null)).toBe('boolean')
  })
})

describe('buildQueryString · boolean', () => {
  it('группы тайтлов, ключей и гео через AND, фразы в кавычках', () => {
    const q = buildQueryString(seg, { code: 'hh' })
    expect(q).toBe('("Менеджер МСФО" OR "IFRS Manager") AND (консолидация OR "IFRS 16") AND Москва')
  })
  it('исключения добавляются как NOT (...)', () => {
    const q = buildQueryString(seg, { code: 'hh' }, ['Сбербанк', 'стажёр', 'длинное предложение которое не подходит для NOT'])
    expect(q).toContain(' NOT (Сбербанк OR стажёр)')
    expect(q).not.toContain('длинное предложение')
  })
  it('дубли и пустые элементы убираются, лимиты соблюдаются', () => {
    const q = buildQueryString({ titles: ['A', 'a', ' ', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }, { code: 'hh' })
    const terms = q.replace(/[()]/g, '').split(' OR ')
    expect(terms.length).toBe(QUERY_LIMITS.titles)
    expect(terms[0]).toBe('A')
  })
  it('одно слово без кавычек, спецсимволы — в кавычках', () => {
    expect(buildQueryString({ titles: ['Java'], keywords: ['C++'] }, { code: 'hh' })).toBe('Java AND "C++"')
  })
  it('пустая гипотеза → пустая строка', () => {
    expect(buildQueryString({}, { code: 'hh' })).toBe('')
  })
})

describe('buildQueryString · xray', () => {
  it('пробел = AND, минус для исключений, без site:', () => {
    const q = buildQueryString(seg, { code: 'google_xray_linkedin', targetSite: 'linkedin.com/in' }, ['Сбербанк'])
    expect(q).toBe('("Менеджер МСФО" OR "IFRS Manager") (консолидация OR "IFRS 16") Москва -Сбербанк')
    expect(q).not.toContain('site:')
  })
})

describe('buildQueryString · plain', () => {
  it('человекочитаемая строка для Telegram', () => {
    const q = buildQueryString(seg, { code: 'telegram' })
    expect(q).toBe('Менеджер МСФО / IFRS Manager — консолидация, IFRS 16 — Москва')
  })
})

describe('usableExclusions', () => {
  it('оставляет короткие фразы, режет по лимиту', () => {
    const out = usableExclusions(['A', 'B C', 'D E F', 'G H I J', 'K', 'L', 'M', 'N'])
    expect(out).not.toContain('G H I J')
    expect(out.length).toBe(QUERY_LIMITS.exclusions)
  })
})
