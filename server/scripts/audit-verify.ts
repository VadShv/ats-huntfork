/**
 * Audit hash-chain verifier (RBAC v2 §7).
 *
 * Recomputes the per-organization hash-chain of activity_log and reports any
 * broken link (tampered/edited/deleted entry). Legacy rows without entry_hash
 * (pre-audit-v2) are treated as "genesis" — the chain starts at the first
 * hashed row per org.
 *
 * Usage: npx tsx server/scripts/audit-verify.ts
 * Requires DATABASE_URL. Exits non-zero if any chain is broken.
 */

import { createHash } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { asc, eq, isNotNull, and } from 'drizzle-orm'
import * as schema from '../database/schema'

const processWithLoadEnv = process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }
if (!process.env.DATABASE_URL && typeof processWithLoadEnv.loadEnvFile === 'function') {
  try { processWithLoadEnv.loadEnvFile('.env') } catch { /* optional */ }
}
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2) }

const { activityLog, organization } = schema

function canonicalJson(e: {
  organizationId: string; actorId: string | null; action: string; resourceType: string
  resourceId: string; metadata: unknown; before: unknown; after: unknown
  decision: string | null; riskLevel: number; fieldSet: string | null; createdAtIso: string
}): string {
  return JSON.stringify([
    e.organizationId, e.actorId, e.action, e.resourceType, e.resourceId,
    e.metadata ?? null, e.before ?? null, e.after ?? null,
    e.decision ?? null, e.riskLevel, e.fieldSet ?? null, e.createdAtIso,
  ])
}

async function main() {
  const client = postgres(DATABASE_URL as string, { max: 1 })
  const db = drizzle(client, { schema })

  const orgs = await db.select({ id: organization.id, name: organization.name }).from(organization)
  let totalBroken = 0
  let totalChecked = 0

  for (const org of orgs) {
    const rows = await db.select().from(activityLog)
      .where(and(eq(activityLog.organizationId, org.id), isNotNull(activityLog.entryHash)))
      .orderBy(asc(activityLog.createdAt))

    let prevHash: string | null = null
    let broken = 0
    for (const r of rows) {
      totalChecked++
      const expected = createHash('sha256')
        .update((prevHash ?? '') + canonicalJson({
          organizationId: r.organizationId,
          actorId: r.actorId,
          action: r.action as string,
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          metadata: r.metadata,
          before: r.before,
          after: r.after,
          decision: r.decision,
          riskLevel: r.riskLevel,
          fieldSet: r.fieldSet,
          createdAtIso: new Date(r.createdAt).toISOString(),
        }))
        .digest('hex')
      if (r.prevHash !== prevHash || r.entryHash !== expected) {
        broken++
        console.error(`  ✗ BROKEN link at ${r.id} (${r.action}, ${new Date(r.createdAt).toISOString()})`)
      }
      prevHash = r.entryHash
    }
    if (rows.length > 0) {
      console.log(`org ${org.name} (${org.id}): ${rows.length} hashed entries, ${broken} broken`)
    }
    totalBroken += broken
  }

  await client.end()
  console.log(`\nAudit verify: ${totalChecked} entries checked across ${orgs.length} orgs, ${totalBroken} broken.`)
  process.exit(totalBroken > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(2) })
