/**
 * Учёт расхода ИИ — инфраструктура процесса (docs/tz-ai-usage.md §3).
 *
 *  - резолвер контекста HTTP-запроса: организация/пользователь (кладёт requirePermission),
 *    маршрут и триггер — для вызовов, где явный контекст не задан;
 *  - проверка бюджетов после записи батча событий;
 *  - сброс буфера событий при остановке сервера.
 */
import { useEvent } from 'nitropack/runtime'
import { AI_ACTOR_CONTEXT_KEY, normalizeAiRoute, setAiRequestResolver, type AiRequestActor } from '../utils/ai/usage/context'
import { flushAiUsage, onAiUsageFlushed } from '../utils/ai/usage/writer'
import { scheduleBudgetCheck } from '../utils/ai/usage/budget'

export default defineNitroPlugin((nitroApp) => {
  setAiRequestResolver(() => {
    let event: ReturnType<typeof useEvent> | undefined
    try {
      event = useEvent()
    }
    catch {
      return null
    }
    if (!event) return null
    const actor = (event.context as Record<string, unknown>)[AI_ACTOR_CONTEXT_KEY] as AiRequestActor | undefined
    const route = normalizeAiRoute(event.path ?? '')
    return {
      organizationId: actor?.organizationId ?? null,
      userId: actor?.userId ?? null,
      source: route || null,
      trigger: route.startsWith('/api/extension/') ? 'extension' : 'user',
    }
  })

  onAiUsageFlushed(orgIds => scheduleBudgetCheck(orgIds))

  nitroApp.hooks.hook('close', async () => {
    await flushAiUsage().catch(() => {})
  })
})
