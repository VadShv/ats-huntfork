import { eq, and, desc, sql, or, isNull, inArray } from 'drizzle-orm'
import { trackingLink, job } from '../../database/schema'
import { trackingLinkQuerySchema } from '../../utils/schemas/trackingLink'
import { getActorContext } from '../../utils/access/actorContext'
import { getScopeJobIds } from '../../utils/access/scope'

/**
 * GET /api/tracking-links
 * List tracking links for the current organization.
 * Supports filtering by job, channel, and active status.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const query = await getValidatedQuery(event, trackingLinkQuerySchema.parse)

  const conditions = [eq(trackingLink.organizationId, orgId)]

  // §D2: restrict to links on jobs in the actor's scope (+ global links, jobId
  // null). Unrestricted (owner/admin/member/lead org) → no extra filter.
  const actor = await getActorContext(event)
  if (actor) {
    const scopeJobIds = await getScopeJobIds(actor)
    if (scopeJobIds !== null) {
      conditions.push(scopeJobIds.length > 0
        ? or(isNull(trackingLink.jobId), inArray(trackingLink.jobId, scopeJobIds))!
        : isNull(trackingLink.jobId))
    }
  }

  if (query.jobId) {
    conditions.push(eq(trackingLink.jobId, query.jobId))
  }
  if (query.channel) {
    conditions.push(eq(trackingLink.channel, query.channel))
  }
  if (query.isActive !== undefined) {
    conditions.push(eq(trackingLink.isActive, query.isActive))
  }

  const offset = (query.page - 1) * query.limit

  const [items, totalCount] = await Promise.all([
    db
      .select({
        id: trackingLink.id,
        jobId: trackingLink.jobId,
        jobTitle: job.title,
        channel: trackingLink.channel,
        name: trackingLink.name,
        code: trackingLink.code,
        utmSource: trackingLink.utmSource,
        utmMedium: trackingLink.utmMedium,
        utmCampaign: trackingLink.utmCampaign,
        utmTerm: trackingLink.utmTerm,
        utmContent: trackingLink.utmContent,
        clickCount: trackingLink.clickCount,
        applicationCount: trackingLink.applicationCount,
        isActive: trackingLink.isActive,
        createdAt: trackingLink.createdAt,
        updatedAt: trackingLink.updatedAt,
      })
      .from(trackingLink)
      .leftJoin(job, eq(job.id, trackingLink.jobId))
      .where(and(...conditions))
      .orderBy(desc(trackingLink.createdAt))
      .limit(query.limit)
      .offset(offset),

    db.$count(trackingLink, and(...conditions)),
  ])

  return {
    data: items,
    total: totalCount,
    page: query.page,
    limit: query.limit,
  }
})
