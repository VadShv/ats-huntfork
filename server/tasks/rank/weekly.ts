/**
 * Nitro scheduled task: weekly rank ladder tick (all organizations).
 * Registered in nuxt.config.ts → nitro.scheduledTasks (Mondays 03:00).
 * Evaluates promo series, decay, placement; snapshots rank_history.
 */
import { runRankTickAllOrgs } from '../../utils/ranks/tick'

export default defineTask({
  meta: {
    name: 'rank:weekly',
    description: 'Недельный тик рангов: промо-серии, decay, placement, снапшот истории',
  },
  async run() {
    const startedAt = Date.now()
    try {
      const { orgs, updated } = await runRankTickAllOrgs()
      const durationMs = Date.now() - startedAt
      console.log(`[rank:weekly] OK orgs=${orgs} updated=${updated} duration=${durationMs}ms`)
      return { result: 'ok', orgs, updated, durationMs }
    } catch (err) {
      console.error('[rank:weekly] failed', err)
      return { result: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  },
})
