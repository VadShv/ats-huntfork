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

  it('принимает textLogic, textField, textPeriod', () => {
    const q = sourcingQuerySchema.parse({
      text: 'python',
      textLogic: 'all',
      textField: 'title',
      textPeriod: 'last_year',
    })
    expect(q.textLogic).toBe('all')
    expect(q.textField).toBe('title')
    expect(q.textPeriod).toBe('last_year')
  })

  it('отвергает невалидный textLogic', () => {
    expect(() => sourcingQuerySchema.parse({ textLogic: 'fuzzy' })).toThrow()
  })

  it('принимает workFormat REMOTE/HYBRID', () => {
    const q = sourcingQuerySchema.parse({ workFormat: ['REMOTE', 'HYBRID'] })
    expect(q.workFormat).toEqual(['REMOTE', 'HYBRID'])
  })

  it('принимает employmentForm FULL', () => {
    const q = sourcingQuerySchema.parse({ employmentForm: ['FULL'] })
    expect(q.employmentForm).toEqual(['FULL'])
  })

  it('принимает professionalRole как массив ID-строк', () => {
    const q = sourcingQuerySchema.parse({ professionalRole: ['96', '36'] })
    expect(q.professionalRole).toEqual(['96', '36'])
  })
})

describe('expandQueryForHhApi — новые поля hh.ru', () => {
  it('маппит textLogic/textField/textPeriod в text.logic/text.field/text.period', () => {
    const params = expandQueryForHhApi(
      { text: 'python', textLogic: 'all', textField: 'title', textPeriod: 'last_year' },
      0,
    )
    expect(params['text.logic']).toBe('all')
    expect(params['text.field']).toBe('title')
    expect(params['text.period']).toBe('last_year')
  })

  it('маппит workFormat → work_format, employmentForm → employment_form', () => {
    const params = expandQueryForHhApi(
      { workFormat: ['REMOTE'], employmentForm: ['FULL'] },
      0,
    )
    expect(params.work_format).toEqual(['REMOTE'])
    expect(params.employment_form).toEqual(['FULL'])
  })

  it('маппит professionalRole → professional_role', () => {
    const params = expandQueryForHhApi({ professionalRole: ['96', '36'] }, 0)
    expect(params.professional_role).toEqual(['96', '36'])
  })
})

describe('parseHhSearchUrl — новые поля', () => {
  it('парсит text.logic/text.field/text.period', () => {
    const q = parseHhSearchUrl(
      'https://hh.ru/search/resume?text=python&text.logic=all&text.field=title&text.period=last_year',
    )
    expect(q.textLogic).toBe('all')
    expect(q.textField).toBe('title')
    expect(q.textPeriod).toBe('last_year')
  })

  it('парсит work_format и employment_form как массивы', () => {
    const q = parseHhSearchUrl(
      'https://hh.ru/search/resume?work_format=REMOTE&work_format=HYBRID&employment_form=FULL',
    )
    expect(q.workFormat).toEqual(['REMOTE', 'HYBRID'])
    expect(q.employmentForm).toEqual(['FULL'])
  })

  it('парсит professional_role как массив ID-строк', () => {
    const q = parseHhSearchUrl(
      'https://hh.ru/search/resume?professional_role=96&professional_role=36',
    )
    expect(q.professionalRole).toEqual(['96', '36'])
  })
})
