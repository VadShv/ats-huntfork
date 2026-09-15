/**
 * POST /api/hh/auto-respond/test
 *
 * Dry-run: render a message template with sample data without sending.
 * Body: { messageTemplate, candidateName?, vacancyName? }
 */
import { renderMessageTemplate } from '../../../utils/hh/autoRespond'

export default defineEventHandler(async (event) => {
  await requirePermission(event, { hhAutoRespond: ['read'] })

  const body = await readBody<{
    messageTemplate?: string
    candidateName?: string
    vacancyName?: string
  }>(event)

  if (!body?.messageTemplate) {
    throw createError({ statusCode: 400, statusMessage: 'Обязательно поле messageTemplate' })
  }

  const rendered = renderMessageTemplate(body.messageTemplate, {
    candidateName: body.candidateName ?? 'Иван Иванов',
    vacancyName: body.vacancyName ?? 'Frontend Developer',
  })

  return { rendered }
})
