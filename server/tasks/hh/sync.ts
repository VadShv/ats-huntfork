/**
 * Nitro scheduled task: фоновая синхронизация откликов с hh.ru.
 *
 * Регистрируется в nuxt.config.ts → nitro.scheduledTasks.
 * Минимальная частота: каждые 5 минут.
 *
 * Семантика «best-effort»: если синк одной вакансии падает,
 * остальные продолжают синхронизироваться. Все ошибки логируются.
 */
import { syncAllActiveLinks } from '../../utils/hh/sync'

export default defineTask({
  meta: {
    name: 'hh:sync',
    description: 'Синхронизация откликов hh.ru для всех активных вакансий',
  },
  async run() {
    const startedAt = Date.now()
    try {
      const results = await syncAllActiveLinks()
      const totals = results.reduce((acc, r) => ({
        fetched: acc.fetched + r.fetched,
        created: acc.created + r.created,
        updated: acc.updated + r.updated,
        failed: acc.failed + r.failed,
      }), { fetched: 0, created: 0, updated: 0, failed: 0 })

      const durationMs = Date.now() - startedAt
      console.log(`[hh:sync] OK links=${results.length} fetched=${totals.fetched} created=${totals.created} updated=${totals.updated} failed=${totals.failed} duration=${durationMs}ms`)
      return { result: 'ok', ...totals, links: results.length, durationMs }
    }
    catch (err) {
      console.error('[hh:sync] FAILED', err)
      return { result: 'error', error: err instanceof Error ? err.message : String(err) }
    }
  },
})
