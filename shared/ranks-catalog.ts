/**
 * Rank divisions catalog (stage D). Bronze..Diamond are RP-threshold based;
 * Legend is relative (top-N by RP, decided in the API).
 */

export interface Division {
  key: string
  name: string
  icon: string
  min: number
  max: number
}

export const DIVISIONS: Division[] = [
  { key: 'bronze', name: 'Бронза', icon: '🥉', min: 0, max: 300 },
  { key: 'silver', name: 'Серебро', icon: '🥈', min: 300, max: 700 },
  { key: 'gold', name: 'Золото', icon: '🥇', min: 700, max: 1300 },
  { key: 'platinum', name: 'Платина', icon: '💠', min: 1300, max: 2200 },
  { key: 'diamond', name: 'Алмаз', icon: '💎', min: 2200, max: 3500 },
]

export const LEGEND = { key: 'legend', name: 'Легенда', icon: '👑' }

export interface DivisionInfo {
  division: string
  name: string
  icon: string
  subrank: number // 1..3 (3 = top third of the division, closer to promotion)
  min: number
  max: number
  atCeiling: boolean
}

/** Resolve division + subrank for an RP value. */
export function divisionForRp(rp: number): DivisionInfo {
  let d = DIVISIONS[0]
  for (const x of DIVISIONS) if (rp >= x.min) d = x
  const span = d.max - d.min
  const frac = span > 0 ? (rp - d.min) / span : 1
  const subrank = frac >= 2 / 3 ? 3 : frac >= 1 / 3 ? 2 : 1
  const atCeiling = rp >= DIVISIONS[DIVISIONS.length - 1].max
  return { division: d.key, name: d.name, icon: d.icon, subrank, min: d.min, max: d.max, atCeiling }
}

/** Next division above the given key (null if top). */
export function nextDivision(key: string): Division | null {
  const i = DIVISIONS.findIndex(d => d.key === key)
  return i >= 0 && i < DIVISIONS.length - 1 ? DIVISIONS[i + 1] : null
}
