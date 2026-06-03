/**
 * POST /api/hh/sync/all
 *
 * Запускает синхронизацию по всем связанным с hh.ru вакансиям ТЕКУЩЕЙ организации.
 * Удобно для ручного «синкнуть всё прямо сейчас» из настроек.
 */
import { and, eq } from 'drizzle-orm'
import { hhAccount, hhVacancyLink } from '../../../database/schema'
import { syncVacancyLink, type SyncLinkResult } from '../../../utils/hh/sync'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  const links = await db
    .select({ id: hhVacancyLink.id })
    .from(hhVacancyLink)
    .innerJoin(hhAccount, eq(hhAccount.id, hhVacancyLink.hhAccountId))
    .where(and(
      eq(hhVacancyLink.organizationId, orgId),
      eq(hhVacancyLink.autoSyncEnabled, true),
      eq(hhAccount.isActive, true),
    ))

  const results: SyncLinkResult[] = []
  for (const l of links) {
    try {
      results.push(await syncVacancyLink(l.id))
    }
    catch (err) {
      results.push({
        linkId: l.id,
        jobId: '',
        fetched: 0, created: 0, updated: 0, failed: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const totals = results.reduce((acc, r) => ({
    fetched: acc.fetched + r.fetched,
    created: acc.created + r.created,
    updated: acc.updated + r.updated,
    failed: acc.failed + r.failed,
  }), { fetched: 0, created: 0, updated: 0, failed: 0 })

  return {
    links: results.length,
    totals,
    results,
  }
})
