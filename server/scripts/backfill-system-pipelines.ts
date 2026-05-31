/**
 * One-time backfill: seed the "Стандартная" system pipeline preset for every
 * existing organization that does not yet have one.
 *
 * Run ONCE after deploying migration 0029_pipelines:
 *
 *   npx tsx server/scripts/backfill-system-pipelines.ts
 *
 * Safe to re-run — seedSystemPipelineForOrg() is idempotent (skips orgs that
 * already have a system pipeline).
 *
 * Requires DATABASE_URL in the environment (loaded from .env if present).
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../database/schema'
import { seedSystemPipelineForOrg } from '../utils/pipeline-seed'

// ─────────────────────────────────────────────
// Env loading
// ─────────────────────────────────────────────

const processWithLoadEnv = process as NodeJS.Process & {
  loadEnvFile?: (path?: string) => void
}

if (!process.env.DATABASE_URL && typeof processWithLoadEnv.loadEnvFile === 'function') {
  try {
    processWithLoadEnv.loadEnvFile('.env')
  }
  catch {
    // .env is optional in hosted environments like Railway
  }
}

function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? ''

  try {
    const parsed = new URL(raw)
    if (parsed.hostname) return raw
  }
  catch {
    // fall through to individual-variable reconstruction
  }

  const host = process.env.PGHOST ?? process.env.RAILWAY_TCP_PROXY_DOMAIN ?? ''
  const port = process.env.PGPORT ?? process.env.RAILWAY_TCP_PROXY_PORT ?? '5432'
  const user = process.env.PGUSER ?? 'postgres'
  const password = process.env.PGPASSWORD ?? ''
  const database = process.env.PGDATABASE ?? 'railway'

  if (host) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
  }

  return ''
}

const DATABASE_URL = resolveDatabaseUrl()
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it in .env or export it.')
  process.exit(1)
}

// ─────────────────────────────────────────────
// Database connection
// ─────────────────────────────────────────────

const client = postgres(DATABASE_URL, { max: 1 })
const db = drizzle(client, { schema })

// ─────────────────────────────────────────────
// Backfill
// ─────────────────────────────────────────────

async function run() {
  console.log('🔄 Backfilling system pipelines for all organizations...')

  const orgs = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)

  console.log(`   Found ${orgs.length} organization(s).`)

  let seeded = 0
  let skipped = 0

  for (const org of orgs) {
    try {
      // seedSystemPipelineForOrg is idempotent — skips if system pipeline exists
      const before = seeded
      await seedSystemPipelineForOrg(db, org.id)
      if (seeded === before) {
        skipped++
        console.log(`   ⏭  Skipped "${org.name}" (${org.id}) — already has a system pipeline`)
      }
      else {
        console.log(`   ✅ Seeded "${org.name}" (${org.id})`)
      }
    }
    catch (err) {
      console.error(`   ❌ Failed for "${org.name}" (${org.id}):`, err)
    }
  }

  // seedSystemPipelineForOrg returns early silently — track via query count difference
  // Re-count to give accurate summary
  const { pipeline: pipelineTable } = schema
  const { eq } = await import('drizzle-orm')
  let actualSeeded = 0
  for (const org of orgs) {
    const [row] = await db
      .select({ id: pipelineTable.id })
      .from(pipelineTable)
      .where(eq(pipelineTable.organizationId, org.id))
      .limit(1)
    if (row) actualSeeded++
  }

  console.log(`\n✅ Done. ${actualSeeded} org(s) now have a system pipeline.`)
  await client.end()
}

run().catch((err) => {
  console.error('Fatal error during backfill:', err)
  process.exit(1)
})
