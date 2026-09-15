/**
 * Nitro scheduled task: detect hh.ru coverage gaps.
 * Runs every 15 minutes, checks all orgs with active vacancy links.
 */
import { eq } from 'drizzle-orm'
import { hhVacancyLink } from '../../database/schema'
import { detectAllCoverageGaps } from '../../utils/hh/coverage'

export default defineTask({
  meta: { name: 'hh:coverage', description: 'Detect hh.ru coverage gaps' },
  async run() {
    const orgIds = await db
      .selectDistinct({ orgId: hhVacancyLink.organizationId })
      .from(hhVacancyLink)
      .where(eq(hhVacancyLink.autoSyncEnabled, true))

    let checked = 0
    for (const { orgId } of orgIds) {
      try {
        await detectAllCoverageGaps(orgId)
        checked++
      }
      catch (err) {
        logError('hh.coverage.failed', {
          orgId,
          error_message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return { result: `Checked ${checked} orgs` }
  },
})
