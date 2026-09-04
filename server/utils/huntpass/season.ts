/**
 * HuntPass season resolution. Season = calendar quarter.
 * Ensures a season row exists for the current quarter (idempotent).
 */
import { and, eq } from 'drizzle-orm'
import { season } from '../../database/schema'
import { SEASON_THEMES } from '../../../shared/season-track'

export interface SeasonWindow {
  id: string
  name: string
  quarter: number
  year: number
  theme: string
  startsAt: Date
  endsAt: Date
}

/** Compute quarter (1..4) and UTC start/end for a given date. */
export function quarterBounds(now = new Date()) {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() // 0..11
  const quarter = Math.floor(month / 3) + 1
  const startMonth = (quarter - 1) * 3
  const startsAt = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0))
  const endsAt = new Date(Date.UTC(year, startMonth + 3, 1, 0, 0, 0) - 1) // last ms of quarter
  return { quarter, year, startsAt, endsAt }
}

/** Get or create the season row for the current quarter. */
export async function getOrCreateCurrentSeason(now = new Date()): Promise<SeasonWindow> {
  const { quarter, year, startsAt, endsAt } = quarterBounds(now)

  const existing = await db.query.season.findFirst({
    where: and(eq(season.quarter, quarter), eq(season.year, year)),
  })
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      quarter: existing.quarter,
      year: existing.year,
      theme: existing.theme,
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
    }
  }

  const meta = SEASON_THEMES[quarter] ?? { name: `Сезон ${quarter}`, theme: 'default' }
  const [row] = await db.insert(season).values({
    name: `${meta.name} ${year}`,
    quarter,
    year,
    theme: meta.theme,
    startsAt,
    endsAt,
    isActive: true,
  }).onConflictDoNothing().returning()

  if (row) {
    return { id: row.id, name: row.name, quarter: row.quarter, year: row.year, theme: row.theme, startsAt: row.startsAt, endsAt: row.endsAt }
  }

  // Race: another request created it — re-read.
  const created = await db.query.season.findFirst({
    where: and(eq(season.quarter, quarter), eq(season.year, year)),
  })
  return {
    id: created!.id,
    name: created!.name,
    quarter: created!.quarter,
    year: created!.year,
    theme: created!.theme,
    startsAt: created!.startsAt,
    endsAt: created!.endsAt,
  }
}
