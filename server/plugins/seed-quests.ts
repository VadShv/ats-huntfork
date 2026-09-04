import { ensureQuestCatalogSeeded } from '../utils/quests'

/**
 * Seed the quest catalog once at startup (after migrations).
 */
export default defineNitroPlugin(async () => {
  if (import.meta.prerender) return

  try {
    await ensureQuestCatalogSeeded()
    console.log('[Reqcore] Quest catalog seeded')
    logInfo('quests.catalog_seeded')
  } catch (error) {
    console.error('[Reqcore] Quest catalog seed failed:', error)
    logError('quests.catalog_seed_failed', {
      error_message: error instanceof Error ? error.message : String(error),
    })
  }
})
