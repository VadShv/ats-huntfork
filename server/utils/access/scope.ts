/**
 * ─────────────────────────────────────────────
 * Scope resolution & filters (RBAC v2, Sprint 3)
 * ─────────────────────────────────────────────
 *
 * Turns an actor's scope (org | departments | jobs | assigned | own) into a
 * concrete set of visible job ids, and provides SQL WHERE fragments to apply it
 * to the sensitive tables. Owner/admin (scope 'org') are UNRESTRICTED → returns
 * null → no extra filter → zero behavior change for them.
 *
 * Data-model realities (see research):
 *   • candidate has NO jobId and NO creator → scope via EXISTS(application…).
 *   • application.jobId is the anchor column.
 *   • document links only to candidateId → scope via EXISTS(application…).
 *   • scope 'own' is NOT expressible (no creator column) → treated as 'assigned'
 *     with a documented gap; never widens access.
 *   • departments scope expands the subtree via recursive CTE (byDepartmentSubtree).
 *
 * The resolved job-id list is memoized on the ActorContext for the request.
 */

import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { ActorContext } from './actorContext'
import { job } from '../../database/schema/app'
import { jobMember } from '../../database/schema/hm'
import { application, candidate, document } from '../../database/schema/app'

// Roles counted as "assigned to a job" for scope 'assigned'.
const ASSIGNED_JOB_ROLES = ['recruiter', 'hiring_manager'] as const

type ScopeJobIds = string[] | null // null = unrestricted (org scope)

// Memo cache on the actor object (per-request, since actor is request-scoped).
const _memo = new WeakMap<ActorContext, ScopeJobIds>()

/**
 * Expand a set of root department ids into the full subtree ids (recursive CTE),
 * scoped to the org. Includes depth guard against accidental cycles.
 */
async function expandDepartmentSubtree(orgId: string, rootIds: string[]): Promise<string[]> {
  if (rootIds.length === 0) return []
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id, 1 AS depth FROM department
        WHERE id IN ${rootIds} AND organization_id = ${orgId}
      UNION ALL
      SELECT d.id, s.depth + 1 FROM department d
        JOIN subtree s ON d.parent_id = s.id
        WHERE s.depth < 32
    )
    SELECT DISTINCT id FROM subtree
  `)
  return rows.map((r) => r.id)
}

/**
 * Resolve the concrete list of job ids visible to the actor.
 * Returns null when the actor is UNRESTRICTED (scope 'org' or owner/admin).
 * Returns [] when the actor legitimately sees no jobs (empty scope).
 */
export async function getScopeJobIds(actor: ActorContext): Promise<ScopeJobIds> {
  if (_memo.has(actor)) return _memo.get(actor)!

  let result: ScopeJobIds

  // Owner/admin or explicit org scope → unrestricted.
  if (actor.scope.type === 'org' || actor.roleKeys.some((r) => r === 'owner' || r === 'admin')) {
    result = null
  }
  else if (actor.scope.type === 'jobs') {
    result = [...new Set(actor.scope.jobIds)]
  }
  else if (actor.scope.type === 'departments') {
    const deptIds = await expandDepartmentSubtree(actor.orgId, actor.scope.departmentIds)
    if (deptIds.length === 0) {
      result = []
    }
    else {
      const rows = await db
        .select({ id: job.id })
        .from(job)
        .where(and(eq(job.organizationId, actor.orgId), inArray(job.departmentId, deptIds)))
      result = rows.map((r) => r.id)
    }
  }
  else {
    // 'assigned' (and 'own' fallback): jobs where the user is a job_member.
    const rows = await db
      .select({ jobId: jobMember.jobId })
      .from(jobMember)
      .where(and(
        eq(jobMember.organizationId, actor.orgId),
        eq(jobMember.userId, actor.userId),
        inArray(jobMember.memberRole, ASSIGNED_JOB_ROLES as unknown as string[]),
      ))
    result = [...new Set(rows.map((r) => r.jobId))]
  }

  _memo.set(actor, result)
  return result
}

/** True when the actor is unrestricted (no scope filtering needed). */
export function isUnrestricted(jobIds: ScopeJobIds): jobIds is null {
  return jobIds === null
}

/**
 * WHERE fragment scoping `application` rows by the actor's visible jobs.
 * Returns undefined when unrestricted. Returns an always-false fragment when
 * the actor sees no jobs (so callers get an empty result, not everything).
 */
export async function applicationScopeCondition(actor: ActorContext): Promise<SQL | undefined> {
  const jobIds = await getScopeJobIds(actor)
  if (jobIds === null) return undefined
  if (jobIds.length === 0) return sql`false`
  return inArray(application.jobId, jobIds)
}

/**
 * WHERE fragment scoping `candidate` rows: visible iff the candidate has an
 * application on a job the actor can see. EXISTS subquery.
 */
export async function candidateScopeCondition(actor: ActorContext): Promise<SQL | undefined> {
  const jobIds = await getScopeJobIds(actor)
  if (jobIds === null) return undefined
  if (jobIds.length === 0) {
    return sql`NOT EXISTS (SELECT 1)` // always false → no candidates
  }
  return sql`EXISTS (
    SELECT 1 FROM application a
    WHERE a.candidate_id = ${candidate.id}
      AND a.organization_id = ${actor.orgId}
      AND a.job_id IN ${jobIds}
  )`
}

/**
 * WHERE fragment scoping `document` rows: visible iff the document's candidate
 * has an application on a job the actor can see.
 */
export async function documentScopeCondition(actor: ActorContext): Promise<SQL | undefined> {
  const jobIds = await getScopeJobIds(actor)
  if (jobIds === null) return undefined
  if (jobIds.length === 0) return sql`false`
  return sql`EXISTS (
    SELECT 1 FROM application a
    WHERE a.candidate_id = ${document.candidateId}
      AND a.organization_id = ${actor.orgId}
      AND a.job_id IN ${jobIds}
  )`
}

/** Is a specific job visible to the actor? (for single-resource pre-checks) */
export async function isJobInScope(actor: ActorContext, jobId: string): Promise<boolean> {
  const jobIds = await getScopeJobIds(actor)
  if (jobIds === null) return true
  return jobIds.includes(jobId)
}

/** Is a specific candidate visible (has an app on a visible job)? */
export async function isCandidateInScope(actor: ActorContext, candidateId: string): Promise<boolean> {
  const jobIds = await getScopeJobIds(actor)
  if (jobIds === null) return true
  if (jobIds.length === 0) return false
  const rows = await db
    .select({ id: application.id })
    .from(application)
    .where(and(
      eq(application.organizationId, actor.orgId),
      eq(application.candidateId, candidateId),
      inArray(application.jobId, jobIds),
    ))
    .limit(1)
  return rows.length > 0
}

// silence unused import in some build paths
void or
