/**
 * Visibility helper for the collaboration thread.
 *
 * Rule (RBAC v2 — fixed in Sprint 3):
 *   - role IN ('owner','admin','member','lead_recruiter') → видит ВСЁ
 *     ('member' — это и есть рекрутер; 'recruiter' — синоним-пресет)
 *   - role = 'hiring_manager' | 'external_recruiter'      → только is_internal=false
 *
 * BUGFIX: раньше в наборе стояла НЕсуществующая org-роль 'recruiter', из-за чего
 * рекрутер (org-роль 'member') НЕ видел внутренние комментарии (audit-rbac.md §5).
 *
 * The helper returns a SQL fragment that callers append to their WHERE clause.
 */

import { and, eq, sql, type SQL } from 'drizzle-orm'
import { member } from '../../database/schema/auth'
import { applicationComment } from '../../database/schema/app'

export type Role = 'owner' | 'admin' | 'recruiter' | 'lead_recruiter' | 'hiring_manager' | 'member' | 'external_recruiter' | string

const INTERNAL_VISIBLE_ROLES = new Set<Role>(['owner', 'admin', 'member', 'recruiter', 'lead_recruiter'])

export function canSeeInternal(role: Role | null | undefined): boolean {
  if (!role) return false
  return INTERNAL_VISIBLE_ROLES.has(role)
}

/**
 * Resolve the current member's role within an organization.
 * Returns `null` if the user is not an active member of the org.
 */
export async function getMemberRole(
  database: typeof db,
  organizationId: string,
  userId: string,
): Promise<Role | null> {
  const row = await database
    .select({ role: member.role, status: member.status })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  if (row.length === 0) return null
  if (row[0].status !== 'active') return null
  return row[0].role
}

/**
 * SQL fragment to filter comments by visibility.
 * If the role can see internal comments, returns `TRUE` (no extra filter).
 * Otherwise returns `application_comment.is_internal = false`.
 */
export function visibilityFilter(role: Role | null | undefined): SQL {
  if (canSeeInternal(role)) return sql`TRUE`
  return eq(applicationComment.isInternal, false)
}
