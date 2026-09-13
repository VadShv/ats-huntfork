import { createHash } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { activityLog } from '../database/schema'

type ActivityAction = typeof activityLog.$inferInsert.action

/** Canonical, stable serialization of the audited fields for hashing. */
function canonicalJson(entry: {
  organizationId: string
  actorId: string | null
  action: string
  resourceType: string
  resourceId: string
  metadata: Record<string, unknown> | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  decision: string | null
  riskLevel: number
  fieldSet: string | null
  createdAtIso: string
}): string {
  // Deterministic key order.
  return JSON.stringify([
    entry.organizationId, entry.actorId, entry.action, entry.resourceType,
    entry.resourceId, entry.metadata ?? null, entry.before ?? null, entry.after ?? null,
    entry.decision ?? null, entry.riskLevel, entry.fieldSet ?? null, entry.createdAtIso,
  ])
}

// Stable advisory-lock namespace for the audit hash-chain (arbitrary constant).
const AUDIT_LOCK_NS = 0x4155_4449 // "AUDI"

/**
 * Record an activity in the immutable, hash-chained audit trail (RBAC v2 §7).
 *
 * Hash-chain: entry_hash = sha256(prev_hash || canonical_json(entry)), chained
 * per organization. Computed under a per-org advisory lock so concurrent writes
 * get the correct prev_hash. A broken/edited/deleted entry breaks verification
 * (see scripts/audit-verify).
 *
 * Fire-and-forget by default (never throws, to not disrupt the primary op). For
 * risk >= 1 (security-relevant), failures are logged loudly so they surface.
 */
export async function recordActivity(params: {
  organizationId: string
  actorId: string | null
  action: ActivityAction
  resourceType: string
  resourceId: string
  metadata?: Record<string, unknown>
  // ── audit v2 (optional) ──
  actorEmail?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  ip?: string | null
  userAgent?: string | null
  decision?: 'allow' | 'deny' | null
  policyReason?: string | null
  riskLevel?: number
  fieldSet?: string | null
}): Promise<void> {
  const riskLevel = params.riskLevel ?? 0
  try {
    await db.transaction(async (tx) => {
      // Serialize hash-chain writes for this org.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_NS}, hashtext(${params.organizationId}))`)

      const [prev] = await tx
        .select({ entryHash: activityLog.entryHash })
        .from(activityLog)
        .where(and(eq(activityLog.organizationId, params.organizationId), sql`${activityLog.entryHash} IS NOT NULL`))
        .orderBy(desc(activityLog.createdAt))
        .limit(1)
      const prevHash = prev?.entryHash ?? null

      const createdAtIso = new Date().toISOString()
      const entryHash = createHash('sha256')
        .update((prevHash ?? '') + canonicalJson({
          organizationId: params.organizationId,
          actorId: params.actorId,
          action: params.action,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
          metadata: params.metadata ?? null,
          before: params.before ?? null,
          after: params.after ?? null,
          decision: params.decision ?? null,
          riskLevel,
          fieldSet: params.fieldSet ?? null,
          createdAtIso,
        }))
        .digest('hex')

      await tx.insert(activityLog).values({
        organizationId: params.organizationId,
        actorId: params.actorId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        metadata: params.metadata ?? null,
        actorEmail: params.actorEmail ?? null,
        before: params.before ?? null,
        after: params.after ?? null,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
        decision: params.decision ?? null,
        policyReason: params.policyReason ?? null,
        riskLevel,
        fieldSet: params.fieldSet ?? null,
        prevHash,
        entryHash,
        createdAt: new Date(createdAtIso),
      })
    })
  }
  catch (err) {
    // Never break the primary op. Log loudly for security-relevant records.
    const log = riskLevel >= 1 ? logError : logWarn
    log('activity.record_failed', {
      org_id: params.organizationId,
      action: String(params.action),
      resource_type: params.resourceType,
      resource_id: params.resourceId,
      risk_level: String(riskLevel),
      error_message: err instanceof Error ? err.message : String(err),
    })
  }
}
