import { and, eq, asc, desc, ilike } from 'drizzle-orm'
import { questionPreset } from '../../../database/schema'

/**
 * GET /api/question-bank/presets — каталог пресетов. Фильтры: status, interviewType, search.
 * Пагинация limit/offset (§11a). view.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId

  const q = getQuery(event)
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100)
  const offset = Math.max(Number(q.offset) || 0, 0)
  const search = typeof q.search === 'string' ? q.search.trim() : ''

  const conds = [eq(questionPreset.organizationId, orgId)]
  if (typeof q.status === 'string' && q.status) conds.push(eq(questionPreset.status, q.status as never))
  if (typeof q.interviewType === 'string' && q.interviewType) conds.push(eq(questionPreset.interviewType, q.interviewType as never))
  if (search) conds.push(ilike(questionPreset.name, `%${search}%`))

  const items = await db.query.questionPreset.findMany({
    where: and(...conds),
    orderBy: [desc(questionPreset.isDefault), asc(questionPreset.name)],
    limit,
    offset,
    with: { sections: { with: { questions: true } } },
  })
  return { items, limit, offset }
})
