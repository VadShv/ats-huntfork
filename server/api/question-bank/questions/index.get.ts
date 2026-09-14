import { and, eq, asc, desc, ilike } from 'drizzle-orm'
import { bankQuestion } from '../../../database/schema'

/**
 * GET /api/question-bank/questions
 * Список/поиск вопросов банка. Фильтры: topicId, type, status, stage, careReady, search.
 * Пагинация limit/offset (cross-cutting §11a).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId

  const q = getQuery(event)
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100)
  const offset = Math.max(Number(q.offset) || 0, 0)
  const search = typeof q.search === 'string' ? q.search.trim() : ''

  const conds = [eq(bankQuestion.organizationId, orgId)]
  if (typeof q.topicId === 'string' && q.topicId) conds.push(eq(bankQuestion.primaryTopicId, q.topicId))
  if (typeof q.type === 'string' && q.type) conds.push(eq(bankQuestion.type, q.type as never))
  if (typeof q.status === 'string' && q.status) conds.push(eq(bankQuestion.status, q.status as never))
  if (typeof q.stage === 'string' && q.stage) conds.push(eq(bankQuestion.recommendedStage, q.stage as never))
  if (q.careReady === 'true') conds.push(eq(bankQuestion.careReady, true))
  if (search) conds.push(ilike(bankQuestion.text, `%${search}%`))

  const items = await db.query.bankQuestion.findMany({
    where: and(...conds),
    orderBy: [desc(bankQuestion.updatedAt), asc(bankQuestion.text)],
    limit,
    offset,
    with: { probes: true, primaryTopic: { columns: { id: true, name: true, type: true } } },
  })

  return { items, limit, offset }
})
