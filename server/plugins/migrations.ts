import { sql } from 'drizzle-orm'
import { db } from '../utils/db'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

interface PendingMigration {
  sql: string[]
  folderMillis: number
  hash: string
}

/**
 * Read drizzle migration files in journal order with their sha256 hashes.
 * Inlined (instead of importing from drizzle-orm/migrator) because that
 * module pulls node:fs/node:crypto into the Rollup build graph in a way
 * that breaks the Nitro server bundle.
 */
function readMigrations(migrationsFolder: string): PendingMigration[] {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json')
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string; when: number }[]
  }
  const migrations: PendingMigration[] = []
  for (const entry of journal.entries) {
    const filePath = path.join(migrationsFolder, `${entry.tag}.sql`)
    const query = fs.readFileSync(filePath, 'utf8')
    migrations.push({
      sql: query.split('--> statement-breakpoint'),
      folderMillis: entry.when,
      hash: crypto.createHash('sha256').update(query).digest('hex'),
    })
  }
  return migrations
}

export default defineNitroPlugin(async () => {
  // Skip during build-time prerendering — database isn't available
  if (import.meta.prerender) return

  // Railway handles schema sync via preDeploy commands.
  // Running runtime migrations there can conflict with drizzle-kit push/migrate.
  if (process.env.RAILWAY_ENVIRONMENT_ID) {
    console.log('[Reqcore] Skipping runtime migrations on Railway (handled in preDeploy)')
    logInfo('migrations.skipped_railway')
    return
  }

  // Advisory lock ID — prevents concurrent migration runs across instances.
  // The lock is automatically released when the session/connection ends.
  const MIGRATION_LOCK_ID = 123456789

  try {
    // pg_try_advisory_lock returns true if lock acquired, false if another process holds it
    const lockResult = await db.execute<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(${MIGRATION_LOCK_ID}) as locked`
    )
    const locked = lockResult[0]?.locked ?? false

    if (!locked) {
      console.log('[Reqcore] Another instance is running migrations, skipping')
      logInfo('migrations.skipped_locked')
      return
    }

    console.log('[Reqcore] Running database migrations...')
    // Suppress harmless NOTICE messages (e.g. "schema already exists, skipping")
    await db.execute(`SET client_min_messages TO warning`)

    // ── Apply migrations with per-statement autocommit ──────────────────
    // drizzle's migrate() wraps ALL migrations in a single transaction.
    // PostgreSQL forbids using a newly added enum value (ALTER TYPE ADD VALUE)
    // until the transaction commits, so enum migrations break on a fresh DB.
    // We read the migrations ourselves (correct sha256 hashes + journal order)
    // but execute each statement with autocommit instead of one big transaction.
    const migrations = readMigrations('./server/database/migrations')

    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`)
    await db.execute(sql`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`)

    const appliedRows = await db.execute<{ hash: string }>(
      sql`SELECT hash FROM "drizzle"."__drizzle_migrations"`
    )
    const appliedHashes = new Set(appliedRows.map((r) => r.hash))

    let applied = 0
    for (const migration of migrations) {
      if (appliedHashes.has(migration.hash)) continue
      for (const stmt of migration.sql) {
        const trimmed = stmt.trim()
        if (!trimmed) continue
        await db.execute(sql.raw(trimmed))
      }
      await db.execute(
        sql`INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES (${migration.hash}, ${migration.folderMillis})`
      )
      applied++
    }

    await db.execute(`SET client_min_messages TO notice`)
    console.log(
      `[Reqcore] Database migrations applied successfully${applied ? ` (${applied} new)` : ''}`
    )
    logInfo('migrations.completed')
  } catch (error) {
    console.error('[Reqcore] Migration failed:', error)
    logError('migrations.failed', {
      error_message: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    await db.execute(
      `SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`
    ).catch(() => {})
  }
})
