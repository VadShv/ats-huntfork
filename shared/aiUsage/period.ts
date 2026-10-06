/**
 * Календарные периоды учёта расхода ИИ в часовом поясе организации.
 * created_at в БД хранится как UTC (timestamp без зоны) — границы считаем как
 * UTC-моменты начала суток/месяца в заданной зоне.
 */

export const DEFAULT_AI_USAGE_TZ = 'Europe/Moscow'

interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p: Record<string, number> = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour === 24 ? 0 : p.hour!, minute: p.minute!, second: p.second! }
}

/** Смещение зоны относительно UTC в минутах для момента date. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const z = zonedParts(date, timeZone)
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000)
}

/** UTC-момент локальной полуночи (year, month, day) в зоне. */
export function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day))
  const off = tzOffsetMinutes(guess, timeZone)
  const result = new Date(guess.getTime() - off * 60_000)
  // Поправка на переход DST между guess и результатом.
  const off2 = tzOffsetMinutes(result, timeZone)
  return off2 === off ? result : new Date(guess.getTime() - off2 * 60_000)
}

export function periodStart(period: 'month' | 'day', now: Date = new Date(), timeZone = DEFAULT_AI_USAGE_TZ): Date {
  const z = zonedParts(now, timeZone)
  return period === 'month'
    ? zonedMidnightUtc(z.year, z.month, 1, timeZone)
    : zonedMidnightUtc(z.year, z.month, z.day, timeZone)
}

export function periodEnd(period: 'month' | 'day', now: Date = new Date(), timeZone = DEFAULT_AI_USAGE_TZ): Date {
  const z = zonedParts(now, timeZone)
  if (period === 'day') {
    const next = new Date(Date.UTC(z.year, z.month - 1, z.day + 1))
    return zonedMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone)
  }
  const nextMonth = z.month === 12 ? { y: z.year + 1, m: 1 } : { y: z.year, m: z.month + 1 }
  return zonedMidnightUtc(nextMonth.y, nextMonth.m, 1, timeZone)
}

/** День месяца и число дней в месяце в зоне — для прогноза. */
export function monthProgress(now: Date = new Date(), timeZone = DEFAULT_AI_USAGE_TZ): { dayOfMonth: number; daysInMonth: number } {
  const z = zonedParts(now, timeZone)
  const daysInMonth = new Date(Date.UTC(z.year, z.month, 0)).getUTCDate()
  return { dayOfMonth: z.day, daysInMonth }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  }
  catch {
    return false
  }
}
