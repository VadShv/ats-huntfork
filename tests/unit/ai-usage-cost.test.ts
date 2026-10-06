import { describe, it, expect } from 'vitest'
import {
  computeCost, crossedThresholds, estimateTokens, forecastMonth, formatMoney, fxRate, hasPrice, priceSnapshot, roundMoney,
} from '../../shared/aiUsage/cost'

/** Формула стоимости и валюты — docs/tz-ai-usage.md §6.2, §4.3. */
describe('computeCost', () => {
  const usage = { inputTokens: 1_000_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 500_000, reasoningTokens: 0 }

  it('считает вход и выход по цене за 1М', () => {
    expect(computeCost(usage, priceSnapshot({ inputPricePer1m: '2.5', outputPricePer1m: '10' }))).toBe(7.5)
  })

  it('кэшированный вход тарифицируется по своей цене', () => {
    const u = { ...usage, cachedInputTokens: 400_000 }
    // 600k × 2.5 + 400k × 0.25 + 500k × 10 = 1.5 + 0.1 + 5
    expect(computeCost(u, priceSnapshot({ inputPricePer1m: 2.5, cachedInputPricePer1m: 0.25, outputPricePer1m: 10 }))).toBeCloseTo(6.6, 6)
  })

  it('без цены кэша кэш идёт по цене входа', () => {
    const u = { ...usage, cachedInputTokens: 400_000 }
    expect(computeCost(u, priceSnapshot({ inputPricePer1m: 2.5, outputPricePer1m: 10 }))).toBe(7.5)
  })

  it('reasoning не умножается отдельно — он уже внутри output', () => {
    const u = { ...usage, reasoningTokens: 300_000 }
    expect(computeCost(u, priceSnapshot({ inputPricePer1m: 2.5, outputPricePer1m: 10 }))).toBe(7.5)
  })

  it('нет цены → null (вызов «без цены», не 0)', () => {
    const p = priceSnapshot({ inputPricePer1m: null, outputPricePer1m: null })
    expect(hasPrice(p)).toBe(false)
    expect(computeCost(usage, p)).toBeNull()
  })

  it('валюта цены по умолчанию USD, RUB распознаётся', () => {
    expect(priceSnapshot({}).currency).toBe('USD')
    expect(priceSnapshot({ priceCurrency: 'RUB' }).currency).toBe('RUB')
  })

  it('мелкие суммы не обнуляются округлением', () => {
    const tiny = { inputTokens: 120, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 40, reasoningTokens: 0 }
    const c = computeCost(tiny, priceSnapshot({ inputPricePer1m: 0.15, outputPricePer1m: 0.6 }))
    expect(c).toBeGreaterThan(0)
    expect(roundMoney(0.0000424)).toBeCloseTo(0.000042, 6)
  })
})

describe('fxRate', () => {
  it('одна валюта — курс 1', () => expect(fxRate('RUB', 'RUB', 90)).toBe(1))
  it('USD → RUB по курсу', () => expect(fxRate('USD', 'RUB', 92.5)).toBe(92.5))
  it('RUB → USD обратный курс', () => expect(fxRate('RUB', 'USD', 100)).toBe(0.01))
  it('без курса пересчёт невозможен', () => expect(fxRate('USD', 'RUB', null)).toBeNull())
})

describe('estimateTokens', () => {
  it('≈3.2 символа на токен, округление вверх', () => {
    expect(estimateTokens(32)).toBe(10)
    expect(estimateTokens(33)).toBe(11)
    expect(estimateTokens(0)).toBe(0)
  })
})

describe('forecastMonth', () => {
  it('линейно по среднему с начала месяца', () => {
    expect(forecastMonth({ spentMonthToDate: 1000, spentLast7Days: 700, dayOfMonth: 10, daysInMonth: 30 })).toBe(3000)
  })
  it('если последние 7 дней дороже среднего — по ним', () => {
    // среднее 100/день, последние 7 дней — 200/день
    expect(forecastMonth({ spentMonthToDate: 1000, spentLast7Days: 1400, dayOfMonth: 10, daysInMonth: 30 })).toBe(5000)
  })
  it('в последний день прогноз = факт', () => {
    expect(forecastMonth({ spentMonthToDate: 1234, spentLast7Days: 300, dayOfMonth: 31, daysInMonth: 31 })).toBe(1234)
  })
})

describe('crossedThresholds', () => {
  it('возвращает впервые пересечённые пороги по возрастанию', () => {
    expect(crossedThresholds(85, 100, [100, 50, 80], [])).toEqual([50, 80])
  })
  it('уже отправленные не повторяются', () => {
    expect(crossedThresholds(101, 100, [50, 80, 100], [50, 80])).toEqual([100])
  })
  it('нулевой лимит — ничего', () => {
    expect(crossedThresholds(10, 0, [50], [])).toEqual([])
  })
})

describe('formatMoney', () => {
  it('рубли и доллары', () => {
    expect(formatMoney(1234.5, 'RUB')).toMatch(/1\s?235 ₽/)
    expect(formatMoney(12.5, 'USD')).toBe('$12,50')
  })
  it('null → прочерк', () => expect(formatMoney(null)).toBe('—'))
  it('копейки видны', () => expect(formatMoney(0.0042, 'RUB')).toBe('0,0042 ₽'))
})
