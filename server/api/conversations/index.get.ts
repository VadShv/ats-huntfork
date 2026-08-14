import { desc, eq } from 'drizzle-orm'
import { commsConversation } from '../../database/schema'

/**
 * GET /api/conversations — единая лента диалогов организации (Спринт 18.2).
 *
 * Возвращает до 200 последних диалогов по всем каналам (пока hh, далее
 * telegram/email) с контекстом кандидата и вакансии + суммарный счётчик
 * непрочитанных. Поиск и фильтры — на клиенте (масштаб MVP).
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  const rows = await db.query.commsConversation.findMany({
    where: eq(commsConversation.organizationId, orgId),
    with: {
      candidate: { columns: { id: true, firstName: true, lastName: true, displayName: true } },
      job: { columns: { id: true, title: true } },
    },
    orderBy: [desc(commsConversation.lastMessageAt)],
    limit: 200,
  })

  let unreadTotal = 0
  const items = rows.map((r) => {
    unreadTotal += r.unreadCount
    const candidateName = r.candidate
      ? (r.candidate.displayName || `${r.candidate.firstName} ${r.candidate.lastName}`.trim())
      : null
    return {
      id: r.id,
      channel: r.channel,
      state: r.state,
      applicationId: r.applicationId,
      candidateId: r.candidateId,
      jobId: r.jobId,
      candidateName,
      jobTitle: r.job?.title ?? null,
      canWrite: r.canWrite,
      unreadCount: r.unreadCount,
      lastMessageAt: r.lastMessageAt,
      lastMessagePreview: r.lastMessagePreview,
      lastMessageDirection: r.lastMessageDirection,
    }
  })

  return { items, unreadTotal }
})
