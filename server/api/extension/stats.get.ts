/**
 * GET /api/extension/stats
 *
 * П5 Sidekick: серверная мини-статистика для Хаба панели —
 * вместо локальных агрегатов по storage.local.
 *
 * Метрики:
 *   - myImports24h / myImports7d — кандидаты, созданные мной (журнал активности)
 *   - myNotes7d — мои заметки/комментарии за неделю
 *   - activeApplications — активные отклики организации (не hired/rejected)
 *
 * Ответ: { ok, stats: { myImports24h, myImports7d, myNotes7d, activeApplications } }
 */
import { and, count, eq, gte, notInArray } from 'drizzle-orm'
import { activityLog, application } from '../../database/schema'
import { createRateLimiter } from '../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  message: 'Слишком много запросов. Подождите немного',
})

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const now = Date.now()
  const since24h = new Date(now - 24 * 60 * 60 * 1000)
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000)

  const myCandidateCreates = (since: Date) => db
    .select({ n: count() })
    .from(activityLog)
    .where(and(
      eq(activityLog.organizationId, orgId),
      eq(activityLog.actorId, userId),
      eq(activityLog.action, 'created'),
      eq(activityLog.resourceType, 'candidate'),
      gte(activityLog.createdAt, since),
    ))

  const [imports24h, imports7d, notes7d, activeApps] = await Promise.all([
    myCandidateCreates(since24h),
    myCandidateCreates(since7d),
    db
      .select({ n: count() })
      .from(activityLog)
      .where(and(
        eq(activityLog.organizationId, orgId),
        eq(activityLog.actorId, userId),
        eq(activityLog.action, 'comment_added'),
        gte(activityLog.createdAt, since7d),
      )),
    db
      .select({ n: count() })
      .from(application)
      .where(and(
        eq(application.organizationId, orgId),
        notInArray(application.status, ['hired', 'rejected']),
      )),
  ])

  logApiRequest(event, session, 'extension.stats', {})

  return {
    ok: true,
    stats: {
      myImports24h: imports24h[0]?.n ?? 0,
      myImports7d: imports7d[0]?.n ?? 0,
      myNotes7d: notes7d[0]?.n ?? 0,
      activeApplications: activeApps[0]?.n ?? 0,
    },
  }
})
