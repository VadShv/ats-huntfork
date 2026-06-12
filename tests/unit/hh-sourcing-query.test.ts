/**
 * S6: тесты для server/utils/hh/sourcing/query.ts
 *
 * parseHhSearchUrl и expandQueryForHhApi — чистые функции без БД,
 * можно тестировать напрямую.
 */
import { describe, it, expect } from 'vitest'
import {
  expandQueryForHhApi,
  parseHhSearchUrl,
  sourcingQuerySchema,
} from '../../server/utils/hh/sourcing/query'

describe('parseHhSearchUrl', () => {
  it('парсит базовый URL hh.ru с одним параметром', () => {
    const q = parseHhSearchUrl('https://hh.ru/search/resume?text=python')
    expect(q.text).toBe('python')
  })

  it('собирает массивы из повторяющихся ключей', () => {
    const q = parseHhSearchUrl('https://hh.ru/search/resume?area=1&area=2&area=113')
    expect(q.area).toEqual(['1', '2', '113'])
  })

  it('парсит salary_from и salary_to как числа', () => {
    const q = parseHhSearchUrl('https://hh.ru/search/resume?salary_from=100000&salary_to=200000&currency=RUR')
    expect(q.salaryFrom).toBe(100000)
    expect(q.salaryTo).toBe(200000)
    expect(q.currency).toBe('RUR')
  })

  it('игнорирует malformed числа', () => {
    const q = parseHhSearchUrl('https://hh.ru/search/resume?salary_from=abc')
    expect(q.salaryFrom).toBeUndefined()
  })

  it('пропускает неизвестные параметры', () => {
    const q = parseHhSearchUrl('https://hh.ru/search/resume?text=js&unknown_param=foo&randomXYZ=bar')
    expect(q.text).toBe('js')
    expect((q as any).unknown_param).toBeUndefined()
  })

  it('валидирует enum experience', () => {
    const q = parseHhSearchUrl('https://hh.ru/search/resume?experience=between1And3&experience=between3And6')
    expect(q.experience).toEqual(['between1And3', 'between3And6'])
  })

  it('бросает на полностью невалидном URL', () => {
    expect(() => parseHhSearchUrl('not a url')).toThrow()
  })

  it('игнорирует пустые values', () => {
    const q = parseHhSearchUrl('https://hh.ru/search/resume?text=python&area=')
    expect(q.text).toBe('python')
    expect(q.area).toBeUndefined()
  })

  it('парсит gender, age, period, order_by', () => {
    const q = parseHhSearchUrl(
      'https://hh.ru/search/resume?gender=male&age_from=25&age_to=40&period=30&order_by=publication_time',
    )
    expect(q.gender).toBe('male')
    expect(q.ageFrom).toBe(25)
    expect(q.ageTo).toBe(40)
    expect(q.period).toBe(30)
    expect(q.orderBy).toBe('publication_time')
  })
})

describe('expandQueryForHhApi', () => {
  it('добавляет page и per_page', () => {
    const params = expandQueryForHhApi({}, 0)
    expect(params.page).toBe(0)
    expect(params.per_page).toBe(50)
  })

  it('использует query.perPage если задан', () => {
    const params = expandQueryForHhApi({ perPage: 100 }, 1)
    expect(params.per_page).toBe(100)
  })

  it('передаёт массивы как массивы', () => {
    const params = expandQueryForHhApi({ area: ['1', '2'] }, 0)
    expect(params.area).toEqual(['1', '2'])
  })

  it('маппит educationLevel в education_level', () => {
    const params = expandQueryForHhApi({ educationLevel: ['higher'] }, 0)
    expect(params.education_level).toEqual(['higher'])
    expect((params as any).educationLevel).toBeUndefined()
  })

  it('маппит salaryFrom/salaryTo в salary_from/salary_to', () => {
    const params = expandQueryForHhApi({ salaryFrom: 100000, salaryTo: 200000 }, 0)
    expect(params.salary_from).toBe(100000)
    expect(params.salary_to).toBe(200000)
  })

  it('игнорирует пустые массивы', () => {
    const params = expandQueryForHhApi({ area: [] }, 0)
    expect(params.area).toBeUndefined()
  })

  it('маппит orderBy в order_by', () => {
    const params = expandQueryForHhApi({ orderBy: 'salary_desc' }, 0)
    expect(params.order_by).toBe('salary_desc')
  })
})

describe('sourcingQuerySchema', () => {
  it('принимает пустой объект', () => {
    expect(() => sourcingQuerySchema.parse({})).not.toThrow()
  })

  it('отвергает невалидный period', () => {
    expect(() => sourcingQuerySchema.parse({ period: 999 })).toThrow()
  })

  it('принимает period=30', () => {
    const q = sourcingQuerySchema.parse({ period: 30 })
    expect(q.period).toBe(30)
  })

  it('отвергает невалидный experience', () => {
    expect(() => sourcingQuerySchema.parse({ experience: ['junior'] })).toThrow()
  })

  it('strict mode — отвергает unknown поля', () => {
    expect(() => sourcingQuerySchema.parse({ unknownField: 'x' })).toThrow()
  })
})
