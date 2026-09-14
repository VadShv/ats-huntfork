import { and, eq, asc, ilike, or } from 'drizzle-orm'
import { assessmentTopic } from '../../../database/schema'

/**
 * GET /api/question-bank/topics
 * Список тем оценки организации. Фильтры: type, status, parentTopicId, search.
 * Пагинация: limit (деф. 50, max 100) / offset. cross-cutting §11a.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId

  const q = getQuery(event)
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100)
  const offset = Math.max(Number(q.offset) || 0, 0)
  const search = typeof q.search === 'string' ? q.search.trim() : ''

  const conds = [eq(assessmentTopic.organizationId, orgId)]
  if (typeof q.type === 'string' && q.type) conds.push(eq(assessmentTopic.type, q.type as never))
  if (typeof q.status === 'string' && q.status) conds.push(eq(assessmentTopic.status, q.status as never))
  if (typeof q.parentTopicId === 'string' && q.parentTopicId) conds.push(eq(assessmentTopic.parentTopicId, q.parentTopicId))
  if (search) {
    const like = `%${search}%`
    conds.push(or(ilike(assessmentTopic.name, like), ilike(assessmentTopic.code, like))!)
  }

  const items = await db.query.assessmentTopic.findMany({
    where: and(...conds),
    orderBy: [asc(assessmentTopic.displayOrder), asc(assessmentTopic.name)],
    limit,
    offset,
    with: { scales: { with: { anchors: true } } },
  })

  return { items, limit, offset }
})
