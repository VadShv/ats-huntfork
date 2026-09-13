import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { commsConversation } from '../../database/schema'
import { getActorContext } from '../../utils/access/actorContext'
import { getScopeJobIds } from '../../utils/access/scope'
import { subscribeUnread } from '../../utils/comms/unreadBus'

/**
 * GET /api/conversations/unread-stream — SSE-поток непрочитанных (Спринт 19.5).
 *
 * Отдаёт текущий счётчик сразу при подключении и мгновенно при каждом
 * изменении (новое входящее / прочтение диалога). Heartbeat каждые 25с
 * держит соединение через nginx (proxy_read_timeout 60с по умолчанию).
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  // §G2: resolve the actor's visible jobs once (stream reuses it every tick).
  const actor = await getActorContext(event)
  const scopeJobIds = actor ? await getScopeJobIds(actor) : null

  const res = event.node.res
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // nginx: не буферизовать поток
  res.flushHeaders?.()

  let closed = false

  async function currentUnread(): Promise<number> {
    let where = eq(commsConversation.organizationId, orgId)
    if (scopeJobIds !== null) {
      where = scopeJobIds.length === 0
        ? and(eq(commsConversation.organizationId, orgId), isNull(commsConversation.jobId))!
        : and(eq(commsConversation.organizationId, orgId), or(isNull(commsConversation.jobId), inArray(commsConversation.jobId, scopeJobIds)))!
    }
    const [row] = await db
      .select({ unread: sql<number>`coalesce(sum(${commsConversation.unreadCount}), 0)::int` })
      .from(commsConversation)
      .where(where)
    return row?.unread ?? 0
  }

  function send(n: number) {
    if (closed) return
    res.write(`data: ${JSON.stringify({ unread: n })}\n\n`)
  }

  // Дебаунс 300мс: пачка событий (синк hh) → один запрос к БД
  let debounce: ReturnType<typeof setTimeout> | null = null
  const onChange = () => {
    if (debounce) return
    debounce = setTimeout(() => {
      debounce = null
      currentUnread().then(send).catch(() => {})
    }, 300)
  }

  const unsubscribe = subscribeUnread(orgId, onChange)
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n')
  }, 25000)

  send(await currentUnread())

  // Держим ответ открытым до разрыва соединения клиентом
  await new Promise<void>((resolve) => {
    event.node.req.on('close', () => {
      closed = true
      unsubscribe()
      clearInterval(heartbeat)
      if (debounce) clearTimeout(debounce)
      resolve()
    })
  })
})
