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
import { orgScopeAssignment, memberScope } from '../../database/schema/rbac'
import { member } from '../../database/schema/auth'

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
 * §1 HRBP: resolve visible job ids from org_scope_assignment — jobs whose
 * companyId is an assigned company OR whose departmentId is within the subtree
 * of an assigned department. Returns [] when the HRBP has no assignments.
 */
async function resolveHrbpJobIds(orgId: string, memberId: string): Promise<string[]> {
  const assignments = await db
    .select({ companyId: orgScopeAssignment.companyId, departmentId: orgScopeAssignment.departmentId })
    .from(orgScopeAssignment)
    .where(and(eq(orgScopeAssignment.organizationId, orgId), eq(orgScopeAssignment.memberId, memberId)))

  const companyIds = assignments.map((a) => a.companyId).filter((x): x is string => !!x)
  const rootDeptIds = assignments.map((a) => a.departmentId).filter((x): x is string => !!x)
  if (companyIds.length === 0 && rootDeptIds.length === 0) return []

  const deptIds = rootDeptIds.length > 0 ? await expandDepartmentSubtree(orgId, rootDeptIds) : []

  const preds: SQL[] = []
  if (companyIds.length > 0) preds.push(inArray(job.companyId, companyIds))
  if (deptIds.length > 0) preds.push(inArray(job.departmentId, deptIds))
  if (preds.length === 0) return []

  const rows = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.organizationId, orgId), preds.length === 1 ? preds[0] : or(...preds)))
  return [...new Set(rows.map((r) => r.id))]
}

/**
 * Personal jobs of a user ("Мои") — jobs where they are a job_member
 * (recruiter or hiring_manager). Independent of the wider role scope.
 * Used by the "Мои/Все" toggle's 'mine' side for ALL roles.
 */
export async function getPersonalJobIds(orgId: string, userId: string): Promise<string[]> {
  const rows = await db
    .select({ jobId: jobMember.jobId })
    .from(jobMember)
    .where(and(
      eq(jobMember.organizationId, orgId),
      eq(jobMember.userId, userId),
      inArray(jobMember.memberRole, ASSIGNED_JOB_ROLES as unknown as string[]),
    ))
  return [...new Set(rows.map((r) => r.jobId))]
}

/** Core role-aware scope resolution shared by actor- and (orgId,userId)-paths. */
async function scopeJobIdsCore(p: {
  orgId: string
  userId: string
  memberId: string
  roleKeys: string[]
  scopeType: ScopeType
  departmentIds: string[]
}): Promise<ScopeJobIds> {
  if (p.scopeType === 'org' || p.roleKeys.some((r) => r === 'owner' || r === 'admin')) {
    return null
  }
  if (p.scopeType === 'departments') {
    const deptIds = await expandDepartmentSubtree(p.orgId, p.departmentIds)
    if (deptIds.length === 0) return []
    const rows = await db.select({ id: job.id }).from(job)
      .where(and(eq(job.organizationId, p.orgId), inArray(job.departmentId, deptIds)))
    return rows.map((r) => r.id)
  }
  if (p.scopeType === 'hrbp') {
    return resolveHrbpJobIds(p.orgId, p.memberId)
  }
  if (p.scopeType === 'jobs') {
    // jobs-scope stores explicit ids on member_scope; for the (orgId,userId) path
    // we fall back to personal job_member (hiring_manager) which is equivalent.
    return getPersonalJobIds(p.orgId, p.userId)
  }
  // 'assigned' / 'own' → personal job_member jobs.
  return getPersonalJobIds(p.orgId, p.userId)
}

/**
 * Resolve the concrete list of job ids visible to the actor.
 * Returns null when the actor is UNRESTRICTED (scope 'org' or owner/admin).
 * Returns [] when the actor legitimately sees no jobs (empty scope).
 */
export async function getScopeJobIds(actor: ActorContext): Promise<ScopeJobIds> {
  if (_memo.has(actor)) return _memo.get(actor)!

  let result: ScopeJobIds
  if (actor.scope.type === 'jobs') {
    // Actor path preserves explicit member_scope.jobIds.
    result = [...new Set(actor.scope.jobIds)]
  }
  else {
    result = await scopeJobIdsCore({
      orgId: actor.orgId,
      userId: actor.userId,
      memberId: actor.memberId,
      roleKeys: actor.roleKeys,
      scopeType: actor.scope.type,
      departmentIds: actor.scope.departmentIds,
    })
  }

  _memo.set(actor, result)
  return result
}

/**
 * Role-aware full scope from (orgId, userId) WITHOUT an H3 event/ActorContext.
 * Reads member.role + member_scope and dispatches the same way as getScopeJobIds.
 * Used by the unified legacy resolver (resolveRecruiterScope) so lists/dashboard/
 * analytics scope correctly for ALL roles (lead=org→null, hrbp, external=assigned).
 * Returns null = unrestricted.
 */
export async function resolveUserScopeJobIds(orgId: string, userId: string): Promise<ScopeJobIds> {
  const [row] = await db
    .select({
      memberId: member.id,
      role: member.role,
      scopeType: memberScope.scopeType,
      departmentIds: memberScope.departmentIds,
    })
    .from(member)
    .leftJoin(memberScope, eq(memberScope.memberId, member.id))
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)

  if (!row) return null // unknown → don't over-restrict (auth already passed)

  const roleKeys = [row.role]
  // Effective scope type: explicit member_scope, else role default.
  const scopeType = (row.scopeType as ScopeType | null) ?? defaultScopeForRole(row.role)

  return scopeJobIdsCore({
    orgId,
    userId,
    memberId: row.memberId,
    roleKeys,
    scopeType,
    departmentIds: row.departmentIds ?? [],
  })
}

/** Default scope type by role key (mirror of actorContext.defaultScopeTypeForRole). */
function defaultScopeForRole(roleKey: string): ScopeType {
  switch (roleKey) {
    case 'owner':
    case 'admin':
    case 'lead_recruiter':
      return 'org'
    case 'hiring_manager':
      return 'jobs'
    case 'hrbp':
      return 'hrbp'
    case 'external_recruiter':
      return 'assigned'
    case 'member':
    default:
      return 'org' // §A2: member default → org (sees all; narrow via override)
  }
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

