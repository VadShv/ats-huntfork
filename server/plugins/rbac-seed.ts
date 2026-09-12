import { sql } from 'drizzle-orm'
import { db } from '../utils/db'
import { seedRbac } from '../utils/access/seedRbac'

/**
 * Seed the RBAC v2 permission catalog + system role presets on startup.
 * Runs after migrations (idempotent; tolerant of not-yet-migrated DB).
 *
 * Uses a dedicated advisory lock so concurrent instances don't double-seed.
 * Never throws — seeding must not block app boot (falls back to the static
 * capability map via permissionResolver if the seed is absent).
 */
export default defineNitroPlugin(async () => {
  if (import.meta.prerender) return
  if (process.env.RAILWAY_ENVIRONMENT_ID) {
    // Railway seeds via preDeploy; keep parity with migrations.ts behavior.
  }

  const SEED_LOCK_ID = 123456790

  try {
    const lockResult = await db.execute<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(${SEED_LOCK_ID}) as locked`,
    )
    const locked = lockResult[0]?.locked ?? false
    if (!locked) {
      logInfo('rbac.seed.skipped_locked')
      return
    }

    // Verify the tables exist (migration applied) before seeding.
    const check = await db.execute<{ exists: boolean }>(
      sql`SELECT to_regclass('public.permission') IS NOT NULL AS exists`,
    )
    if (!check[0]?.exists) {
      logWarn('rbac.seed.skipped_no_tables')
      return
    }

    const result = await seedRbac()
    console.log(
      `[Reqcore] RBAC seed ready (permissions=${result.permissions}, roles=${result.roles}, +grants=${result.grants})`,
    )
    logInfo('rbac.seed.completed', {
      permissions: String(result.permissions),
      roles: String(result.roles),
      grants: String(result.grants),
    })
  }
  catch (error) {
    console.error('[Reqcore] RBAC seed failed (non-fatal):', error)
    logError('rbac.seed.failed', {
      error_message: error instanceof Error ? error.message : String(error),
    })
  }
  finally {
    await db.execute(`SELECT pg_advisory_unlock(${SEED_LOCK_ID})`).catch(() => {})
  }
})
