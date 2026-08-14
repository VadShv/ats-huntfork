/**
 * GET /api/comms/messages/:id/attachments/:index
 *
 * Отдаёт вложение сообщения (Telegram-медиа), сохранённое в S3.
 * Доступ только авторизованным пользователям своей организации.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { commsMessage } from '../../../../../database/schema'
import { downloadFromS3 } from '../../../../../utils/s3'

const paramsSchema = z.object({
  id: z.string().min(1),
  index: z.coerce.number().int().min(0).max(50),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const { id, index } = await getValidatedRouterParams(event, paramsSchema.parse)

  const msg = await db.query.commsMessage.findFirst({
    where: and(eq(commsMessage.id, id), eq(commsMessage.organizationId, orgId)),
    columns: { attachments: true },
  })
  if (!msg) {
    throw createError({ statusCode: 404, statusMessage: 'Сообщение не найдено' })
  }

  const list = Array.isArray(msg.attachments) ? msg.attachments as Array<Record<string, unknown>> : []
  const att = list[index]
  const s3Key = att && typeof att.s3Key === 'string' ? att.s3Key : null
  if (!s3Key) {
    throw createError({ statusCode: 404, statusMessage: 'Вложение недоступно' })
  }

  const buffer = await downloadFromS3(s3Key)
  const name = typeof att.name === 'string' ? att.name : 'file'
  const mime = typeof att.mimeType === 'string' && att.mimeType ? att.mimeType : 'application/octet-stream'

  setHeader(event, 'Content-Type', mime)
  setHeader(event, 'Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`)
  setHeader(event, 'Cache-Control', 'private, max-age=3600')
  return buffer
})
