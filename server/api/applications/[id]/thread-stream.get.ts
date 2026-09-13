import { and, eq } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../utils/access/scope'
import { application } from '../../../database/schema/app'
import { applicationIdParamSchema } from '../../../utils/schemas/application'
import { subscribeThread } from '../../../utils/comments/threadBus'
import { getTyping } from '../../../utils/comments/typing-store'

/**
 * GET /api/applications/:id/thread-stream — SSE-поток изменений обсуждения (Этап 4).
 *
 * Отдаёт лёгкий пинг `{ changed: true }` при каждом изменении треда
 * (новый комментарий/снимок, редактирование, удаление, реакция, смена этапа).
 * Клиент по пингу перезапрашивает ленту (дебаунс на клиенте). Heartbeat 25с
 * держит соединение через прокси. Полезная нагрузка не передаётся — видимость
 * (is_internal и т.п.) применяется при обычном GET /comments.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, id as string, orgId)

  // Проверка принадлежности отклика организации (без утечки чужих тредов).
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  const res = event.node.res
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  let closed = false

  function ping() {
    if (closed) return
    res.write(`data: ${JSON.stringify({ changed: true })}\n\n`)
  }

  // Дебаунс 250мс: пачка изменений → один пинг
  let debounce: ReturnType<typeof setTimeout> | null = null
  const onChange = () => {
    if (debounce) return
    debounce = setTimeout(() => {
      debounce = null
      ping()
    }, 250)
  }

  const unsubscribe = subscribeThread(id, onChange)
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n')
  }, 25000)

  // Typing indicators — poll every 2s
  const typingInterval = setInterval(() => {
    if (closed) return
    const typing = getTyping(id, session.user.id)
    if (typing.length > 0) {
      res.write(`data: ${JSON.stringify({ typing })}\n\n`)
    }
  }, 2000)

  // Начальный сигнал — клиент сразу подтянет актуальное состояние.
  res.write(`data: ${JSON.stringify({ ready: true })}\n\n`)

  await new Promise<void>((resolve) => {
    event.node.req.on('close', () => {
      closed = true
      unsubscribe()
      clearInterval(heartbeat)
      clearInterval(typingInterval)
      if (debounce) clearTimeout(debounce)
      resolve()
    })
  })
})
