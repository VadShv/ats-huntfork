/**
 * Nitro scheduled task: daily snapshot of hh.ru funnel stats.
 *
 * Runs at 02:00 every day. For each org with active vacancy links,
 * computes funnel + time metrics and stores them in hh_stats_snapshot
 * for trend charts.
 */
import { eq } from 'drizzle-orm'
import { hhVacancyLink } from '../../database/schema'
import { snapshotStats } from '../../utils/hh/stats'

export default defineTask({
  meta: {
    name: 'hh:stats',
    description: 'Ежедневный снимок метрик hh.ru для графиков',
  },
  async run() {
    try {
      const orgRows = await db
        .selectDistinct({ orgId: hhVacancyLink.organizationId })
        .from(hhVacancyLink)
        .where(eq(hhVacancyLink.autoSyncEnabled, true))

      for (const { orgId } of orgRows) {
        try {
          await snapshotStats(orgId)
        }
        catch (err) {
          console.error(`[hh:stats] FAILED org=${orgId}`, err)
        }
      }

      console.log(`[hh:stats] OK orgs=${orgRows.length}`)
      return { result: 'ok', orgs: orgRows.length }
    }
    catch (err) {
      console.error('[hh:stats] FAILED', err)
      return { result: 'error', error: err instanceof Error ? err.message : String(err) }
    }
  },
})
