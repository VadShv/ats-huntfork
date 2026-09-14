import { and, eq, asc } from 'drizzle-orm'
import { reportTemplate } from '../../../database/schema'
import { ensureDefaultReportTemplate } from '../../../utils/questions/seedReportTemplate'

/** GET /api/question-bank/report-templates — список шаблонов. Фильтр kind. Пагинация. view. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId
  await ensureDefaultReportTemplate(orgId, session.user.id)

  const q = getQuery(event)
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100)
  const offset = Math.max(Number(q.offset) || 0, 0)

  const conds = [eq(reportTemplate.organizationId, orgId)]
  if (q.activeOnly === 'true') conds.push(eq(reportTemplate.isActive, true))
  if (typeof q.kind === 'string' && q.kind) conds.push(eq(reportTemplate.kind, q.kind as never))

  const items = await db.query.reportTemplate.findMany({
    where: and(...conds),
    orderBy: [asc(reportTemplate.name)],
    limit,
    offset,
  })
  return { items, limit, offset }
})
