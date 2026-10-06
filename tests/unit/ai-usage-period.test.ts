import { describe, it, expect } from 'vitest'
import { isValidTimeZone, monthProgress, periodEnd, periodStart, zonedMidnightUtc } from '../../shared/aiUsage/period'

/** Границы периодов бюджета в часовом поясе отчётов — docs/tz-ai-usage.md §7.2. */
describe('period (Europe/Moscow)', () => {
  const tz = 'Europe/Moscow'

  it('полночь по Москве = 21:00 UTC предыдущего дня', () => {
    expect(zonedMidnightUtc(2026, 10, 1, tz).toISOString()).toBe('2026-09-30T21:00:00.000Z')
  })

  it('начало месяца с учётом часового пояса', () => {
    // 30 сентября 22:30 UTC = 1 октября 01:30 МСК → уже октябрь
    const now = new Date('2026-09-30T22:30:00Z')
    expect(periodStart('month', now, tz).toISOString()).toBe('2026-09-30T21:00:00.000Z')
    expect(periodEnd('month', now, tz).toISOString()).toBe('2026-10-31T21:00:00.000Z')
  })

  it('день', () => {
    const now = new Date('2026-10-06T12:00:00Z')
    expect(periodStart('day', now, tz).toISOString()).toBe('2026-10-05T21:00:00.000Z')
    expect(periodEnd('day', now, tz).toISOString()).toBe('2026-10-06T21:00:00.000Z')
  })

  it('переход через год', () => {
    const now = new Date('2026-12-31T22:00:00Z') // 1 января 01:00 МСК
    expect(periodStart('month', now, tz).toISOString()).toBe('2026-12-31T21:00:00.000Z')
  })

  it('прогресс месяца', () => {
    expect(monthProgress(new Date('2026-02-10T12:00:00Z'), tz)).toEqual({ dayOfMonth: 10, daysInMonth: 28 })
  })

  it('валидация часового пояса', () => {
    expect(isValidTimeZone('Europe/Moscow')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
  })
})
