import { ensureCatalogSeeded } from '../utils/achievements/check'

/**
 * Seed the achievement catalog once at server startup (after migrations).
 * Removes the 21 INSERT...ON CONFLICT from the hot path of every checkAchievements call.
 */
export default defineNitroPlugin(async () => {
  // Skip during build-time prerendering — database isn't available
  if (import.meta.prerender) return

  try {
    await ensureCatalogSeeded()
    console.log('[Reqcore] Achievement catalog seeded')
    logInfo('achievements.catalog_seeded')
  } catch (error) {
    console.error('[Reqcore] Achievement catalog seed failed:', error)
    logError('achievements.catalog_seed_failed', {
      error_message: error instanceof Error ? error.message : String(error),
    })
    // Non-fatal: checkAchievements can still upsert on demand if needed.
  }
})
