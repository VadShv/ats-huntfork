import { describe, it, expect } from 'vitest'
import { normalizeQuestion } from '../../server/utils/text/normalizeQuestion'

describe('normalizeQuestion (единый util, Спринт 0)', () => {
  it('приводит к нижнему регистру', () => {
    expect(normalizeQuestion('РАССКАЖИТЕ')).toBe('расскажите')
  })

  it('схлопывает множественные пробелы', () => {
    expect(normalizeQuestion('опыт    с   redis')).toBe('опыт с redis')
  })

  it('удаляет кавычки-ёлочки и пунктуацию', () => {
    expect(normalizeQuestion('Опыт с «PostgreSQL»?')).toBe('опыт с postgresql')
    expect(normalizeQuestion('Почему, вы, уходите?!')).toBe('почему вы уходите')
  })

  it('тримит края', () => {
    expect(normalizeQuestion('   вопрос   ')).toBe('вопрос')
  })

  it('идемпотентна: f(f(x)) === f(x)', () => {
    const x = '  Расскажите  про «Kafka»?! '
    expect(normalizeQuestion(normalizeQuestion(x))).toBe(normalizeQuestion(x))
  })

  it('пустая/undefined строка → пустая строка', () => {
    expect(normalizeQuestion('')).toBe('')
    // @ts-expect-error проверка защиты от null
    expect(normalizeQuestion(null)).toBe('')
    // @ts-expect-error проверка защиты от undefined
    expect(normalizeQuestion(undefined)).toBe('')
  })

  it('дедуп: разный регистр/пунктуация/пробелы → одинаковый ключ', () => {
    expect(normalizeQuestion('Опыт с PostgreSQL?')).toBe(normalizeQuestion('опыт   с postgresql'))
  })
})
