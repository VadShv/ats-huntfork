/**
 * Idempotent watcher subscription helper.
 *
 * `application_watcher` has UNIQUE (application_id, user_id), so any duplicate
 * insertion is silently dropped. We never overwrite the `source` — first write wins.
 */

import { applicationWatcher } from '../../database/schema/app'

export type WatcherSource = 'manual' | 'auto_mention' | 'auto_author' | 'auto_assignee'

export async function ensureWatcher(
  database: typeof db,
  params: {
    organizationId: string
    applicationId: string
    userId: string
    source: WatcherSource
  },
): Promise<void> {
  await database
    .insert(applicationWatcher)
    .values({
      organizationId: params.organizationId,
      applicationId: params.applicationId,
      userId: params.userId,
      source: params.source,
    })
    .onConflictDoNothing()
}

/**
 * Bulk-ensure variant — same semantics, single SQL round-trip.
 */
export async function ensureWatchers(
  database: typeof db,
  organizationId: string,
  applicationId: string,
  users: Array<{ userId: string; source: WatcherSource }>,
): Promise<void> {
  if (users.length === 0) return
  await database
    .insert(applicationWatcher)
    .values(
      users.map(u => ({
        organizationId,
        applicationId,
        userId: u.userId,
        source: u.source,
      })),
    )
    .onConflictDoNothing()
}
