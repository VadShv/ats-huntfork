import { eq, and, asc } from 'drizzle-orm'
import { createHash } from 'crypto'
import { job, jobBrief, scoringCriterion } from '../../database/schema/app'

/**
 * Compute sha256 hashes of map sources (brief, criteria, description).
 * docs/tz-search-map.md §6.2
 */
export async function computeSourceHashes(
  jobId: string,
  orgId: string,
): Promise<{ brief: string | null; criteria: string | null; description: string | null }> {
  const [j] = await db.select({ title: job.title, description: job.description })
    .from(job).where(and(eq(job.id, jobId), eq(job.organizationId, orgId))).limit(1)

  const descriptionHash = j
    ? sha256(`${j.title}\n${(j.description ?? '').trim().replace(/\s+/g, ' ')}`)
    : null

  const [brief] = await db.select().from(jobBrief)
    .where(and(eq(jobBrief.jobId, jobId), eq(jobBrief.organizationId, orgId))).limit(1)

  const briefHash = brief
    ? sha256(JSON.stringify({
        hardMustHave: sortArr(brief.hardMustHave),
        niceToHave: sortArr(brief.niceToHave),
        dealBreakers: sortArr(brief.dealBreakers),
        redFlagsToWatch: sortArr(brief.redFlagsToWatch),
        responsibilities: sortArr(brief.responsibilities),
        teamContext: brief.teamContext,
        idealProfile: brief.idealProfile,
        sourcingHints: brief.sourcingHints,
        freeform: brief.freeform,
      }))
    : null

  const criteria = await db.select({
    key: scoringCriterion.id,
    name: scoringCriterion.name,
    category: scoringCriterion.category,
    weight: scoringCriterion.weight,
  }).from(scoringCriterion)
    .where(and(eq(scoringCriterion.jobId, jobId), eq(scoringCriterion.organizationId, orgId)))
    .orderBy(asc(scoringCriterion.id))

  const criteriaHash = criteria.length > 0
    ? sha256(JSON.stringify(criteria))
    : null

  return { brief: briefHash, criteria: criteriaHash, description: descriptionHash }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function sortArr(arr: unknown): unknown {
  if (!Array.isArray(arr)) return arr
  return [...arr].sort()
}
