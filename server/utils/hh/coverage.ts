/**
 * Coverage gap detection: find отклики that exist on hh.ru but are
 * NOT imported into Huntfork. Compares live hh.ru negotiations vs.
 * imported hh_negotiation records.
 */
import { and, eq, isNull, inArray } from 'drizzle-orm'
import {
  hhAccount,
  hhCoverageGap,
  hhNegotiation,
  hhVacancyLink,
} from '../../database/schema'
import { apiGet } from './client'
import { getHhSession } from './session'
import { withHhRetry } from './rateLimiter'
import { resolveHhConfig } from './config'
import { getValidAccessToken } from './tokens'
import type { HhSession } from './session'

const EMPLOYER_COLLECTIONS = [
  'response',
  'consider',
  'phone_interview',
  'assessment',
  'interview',
  'offer',
  'hired',
  'discard_by_employer',
  'discard_visible_by_opponent',
  'discard_after_interview',
]

interface HhNegotiationItem {
  id: string
  created_at?: string
  [key: string]: unknown
}

interface HhNegotiationsPage {
  items: HhNegotiationItem[]
  pages?: number
}

/**
 * Get the first active HH account for an org (for background tasks
 * that run without a specific user context).
 */
async function getPrimaryHhAccount(orgId: string) {
  const rows = await db
    .select()
    .from(hhAccount)
    .where(and(eq(hhAccount.organizationId, orgId), eq(hhAccount.isActive, true)))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Build an HhSession for an org using its primary account.
 */
async function getOrgHhSession(orgId: string): Promise<HhSession | null> {
  const config = await resolveHhConfig(orgId)
  if (!config) return null

  const account = await getPrimaryHhAccount(orgId)
  if (!account) return null

  try {
    const accessToken = await getValidAccessToken(account.id)
    return {
      accountId: account.id,
      accessToken,
      config,
      organizationId: orgId,
      userId: account.userId,
    }
  }
  catch {
    return null
  }
}

/**
 * Detect coverage gaps for a single vacancy link.
 */
export async function detectCoverageGaps(args: {
  session: HhSession
  vacancyLinkId: string
}): Promise<{ gaps: number, totalOnHh: number, totalImported: number }> {
  const [link] = await db
    .select()
    .from(hhVacancyLink)
    .where(eq(hhVacancyLink.id, args.vacancyLinkId))
    .limit(1)
  if (!link) return { gaps: 0, totalOnHh: 0, totalImported: 0 }

  const allHhNegotiations: Array<{ id: string, collection: string, createdAt: Date | null }> = []

  for (const collection of EMPLOYER_COLLECTIONS) {
    let page = 0
    while (page < 40) {
      try {
        const result = await withHhRetry(() =>
          apiGet<HhNegotiationsPage>(
            `/negotiations/${collection}`,
            args.session.accessToken,
            { vacancy_id: link.hhVacancyId, page, per_page: 50 },
            args.session.config,
          ),
        )
        for (const item of result.items) {
          allHhNegotiations.push({
            id: item.id,
            collection,
            createdAt: item.created_at ? new Date(item.created_at) : null,
          })
        }
        const hasMore = page < (result.pages ?? 1) - 1
        if (!hasMore) break
        page++
      }
      catch {
        break
      }
    }
  }

  const imported = await db
    .select({ hhId: hhNegotiation.hhNegotiationId })
    .from(hhNegotiation)
    .where(eq(hhNegotiation.hhVacancyLinkId, args.vacancyLinkId))
  const importedIds = new Set(imported.map(n => n.hhId))

  const newGaps: Array<{
    hhNegotiationId: string
    hhCollection: string
    hhCreatedAt: Date | null
  }> = []
  for (const hhNego of allHhNegotiations) {
    if (!importedIds.has(hhNego.id)) {
      newGaps.push({
        hhNegotiationId: hhNego.id,
        hhCollection: hhNego.collection,
        hhCreatedAt: hhNego.createdAt,
      })
    }
  }

  const hhNegoIdsOnHh = new Set(allHhNegotiations.map(n => n.id))
  const existingGaps = await db
    .select()
    .from(hhCoverageGap)
    .where(and(
      eq(hhCoverageGap.vacancyLinkId, args.vacancyLinkId),
      isNull(hhCoverageGap.resolvedAt),
    ))

  for (const existing of existingGaps) {
    if (hhNegoIdsOnHh.has(existing.hhNegotiationId)) {
      // Still a gap — keep it
    }
    else {
      // No longer on hh.ru or now imported — mark resolved
      await db
        .update(hhCoverageGap)
        .set({ resolvedAt: new Date() })
        .where(eq(hhCoverageGap.id, existing.id))
    }
  }

  const existingGapHhIds = new Set(existingGaps.map(g => g.hhNegotiationId))
  const trulyNewGaps = newGaps.filter(g => !existingGapHhIds.has(g.hhNegotiationId))

  if (trulyNewGaps.length > 0) {
    await db
      .insert(hhCoverageGap)
      .values(trulyNewGaps.map(g => ({
        organizationId: args.session.organizationId,
        vacancyLinkId: args.vacancyLinkId,
        hhNegotiationId: g.hhNegotiationId,
        gapReason: 'not_imported',
        hhCollection: g.hhCollection,
        hhCreatedAt: g.hhCreatedAt,
      })))
  }

  return {
    gaps: trulyNewGaps.length,
    totalOnHh: allHhNegotiations.length,
    totalImported: imported.length,
  }
}

/**
 * Detect gaps for all active vacancy links in an org.
 */
export async function detectAllCoverageGaps(orgId: string): Promise<void> {
  const session = await getOrgHhSession(orgId)
  if (!session) return

  const links = await db
    .select({ id: hhVacancyLink.id })
    .from(hhVacancyLink)
    .where(and(
      eq(hhVacancyLink.organizationId, orgId),
      eq(hhVacancyLink.autoSyncEnabled, true),
    ))

  for (const link of links) {
    try {
      await detectCoverageGaps({ session, vacancyLinkId: link.id })
    }
    catch (err) {
      logError('hh.coverage.link_failed', {
        vacancyLinkId: link.id,
        error_message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/**
 * Import a specific gap — re-sync the vacancy link to pull the missing negotiation.
 */
export async function importGap(gapId: string): Promise<{ vacancyLinkId: string }> {
  const [gap] = await db
    .select()
    .from(hhCoverageGap)
    .where(eq(hhCoverageGap.id, gapId))
    .limit(1)
  if (!gap) throw new Error('Gap not found')
  if (gap.resolvedAt) throw new Error('Gap already resolved')

  const { syncVacancyLink } = await import('./sync')
  await syncVacancyLink(gap.vacancyLinkId)

  await db
    .update(hhCoverageGap)
    .set({ resolvedAt: new Date() })
    .where(eq(hhCoverageGap.id, gapId))

  return { vacancyLinkId: gap.vacancyLinkId }
}
