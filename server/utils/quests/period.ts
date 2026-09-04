/**
 * Quest period computation in APP_TIMEZONE.
 * Daily key = 'YYYY-MM-DD'; weekly key = 'YYYY-Www' (ISO week).
 * Window = local day/week bounds converted to UTC instants for SQL.
 */
import { env } from '../env'

export interface Period {
  key: string
  start: Date
  end: Date
}

/** Offset (ms) of the tz from UTC at `date`. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour === 24 ? 0 : +map.hour, +map.minute, +map.second)
  return asUTC - date.getTime()
}

/** Local wall-clock parts (as a "fake UTC" date) for the given tz. */
function localParts(now: Date, tz: string) {
  const offset = tzOffsetMs(now, tz)
  const local = new Date(now.getTime() + offset)
  return { offset, y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate(), dow: local.getUTCDay() }
}

export function dailyPeriod(now = new Date(), tz = env.APP_TIMEZONE): Period {
  const { offset, y, m, d } = localParts(now, tz)
  const startUTC = Date.UTC(y, m, d, 0, 0, 0) - offset
  const start = new Date(startUTC)
  const end = new Date(startUTC + 86_400_000 - 1)
  const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return { key, start, end }
}

export function weeklyPeriod(now = new Date(), tz = env.APP_TIMEZONE): Period {
  const { offset, y, m, d, dow } = localParts(now, tz)
  // Monday-based week: shift back to Monday.
  const daysFromMonday = (dow + 6) % 7
  const mondayUTC = Date.UTC(y, m, d, 0, 0, 0) - daysFromMonday * 86_400_000 - offset
  const start = new Date(mondayUTC)
  const end = new Date(mondayUTC + 7 * 86_400_000 - 1)
  // ISO week number
  const monday = new Date(mondayUTC + offset)
  const thursday = new Date(monday.getTime() + 3 * 86_400_000)
  const isoYear = thursday.getUTCFullYear()
  const jan1 = Date.UTC(isoYear, 0, 1)
  const week = Math.floor((thursday.getTime() - jan1) / (7 * 86_400_000)) + 1
  const key = `${isoYear}-W${String(week).padStart(2, '0')}`
  return { key, start, end }
}
