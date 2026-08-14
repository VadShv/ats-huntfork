/**
 * POST /api/applications/:id/telegram-first-contact — «первый контакт» в личном ТГ.
 *
 * Спринт 19.5: бот НЕ может писать первым даже через Telegram Business
 * (BUSINESS_PEER_USAGE_MISSING). Поэтому Huntfork генерирует ИИ-драфт первого
 * сообщения и отдаёт ссылку t.me/<username>?text=... — рекрутёр открывает чат
 * с уже подставленным текстом и жмёт «Отправить» сам. Когда кандидат ответит,
 * диалог появится в Huntfork автоматически (business_message).
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { application, candidate as candidateTable, job as jobTable } from '../../../database/schema'
import { generateAssistantText } from '../../../utils/comms/assistant'
import { normalizeTgUsername } from '../../../utils/comms/telegram'

const paramsSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const { id: applicationId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    columns: { id: true, candidateId: true, jobId: true },
  })
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }

  const cand = await db.query.candidate.findFirst({
    where: eq(candidateTable.id, app.candidateId),
    columns: { id: true, firstName: true, lastName: true, displayName: true, telegram: true },
  })
  const username = normalizeTgUsername(cand?.telegram)
  if (!username) {
    throw createError({ statusCode: 400, statusMessage: 'У кандидата не указан Telegram (username или ссылка t.me) в карточке' })
  }

  // ИИ-драфт через ассистента; если ассистент не настроен — шаблон
  let text: string | null = null
  try {
    const synthetic = {
      id: `first-contact-${app.id}`,
      candidateId: app.candidateId,
      jobId: app.jobId,
    } as unknown as Parameters<typeof generateAssistantText>[0]
    const res = await generateAssistantText(synthetic, orgId)
    text = res.text?.trim() || null
  }
  catch (err) {
    logWarn('comms.first_contact_ai_failed', {
      application_id: app.id,
      error_message: err instanceof Error ? err.message : String(err),
      module: 'comms',
    })
  }
  if (!text) {
    const jobRow = app.jobId
      ? await db.query.job.findFirst({ where: eq(jobTable.id, app.jobId), columns: { title: true } })
      : undefined
    const name = cand ? (cand.displayName || cand.firstName || '').trim() : ''
    text = `Здравствуйте${name ? `, ${name}` : ''}! Меня зовут ${session.user.name ?? 'рекрутёр'}, я по поводу вакансии${jobRow?.title ? ` «${jobRow.title}»` : ''}. Удобно будет пообщаться здесь?`
  }

  return {
    text,
    username,
    link: `https://t.me/${username}?text=${encodeURIComponent(text)}`,
  }
})
