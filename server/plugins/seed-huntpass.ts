import { getOrCreateCurrentSeason } from '../utils/huntpass/season'

/**
 * Ensure the current HuntPass season exists at startup.
 * Runs after migrations (alphabetical: migrations < seed-huntpass).
 */
export default defineNitroPlugin(async () => {
  if (import.meta.prerender) return

  try {
    const s = await getOrCreateCurrentSeason()
    console.log(`[Reqcore] HuntPass season ready: ${s.name} (Q${s.quarter} ${s.year})`)
    logInfo('huntpass.season_ready')
  } catch (error) {
    console.error('[Reqcore] HuntPass season seed failed:', error)
    logError('huntpass.season_seed_failed', {
      error_message: error instanceof Error ? error.message : String(error),
    })
    // Non-fatal: the API also calls getOrCreateCurrentSeason on demand.
  }
})
