/**
 * Контекст ИИ-операции для учёта расхода — docs/tz-ai-usage.md §3.3.
 *
 * `withAiOperation(ctx, fn)` кладёт в AsyncLocalStorage «что сейчас происходит»:
 * операцию (ключ Банка промптов), сущность, вакансию, инициатора и триггер.
 * Middleware модели (./middleware.ts) читает контекст при каждом вызове LLM —
 * поэтому сигнатуры генераторов менять не нужно.
 *
 * Вложенные вызовы наследуют контекст родителя: внешний (эндпоинт / воркер) задаёт
 * организацию, пользователя, вакансию и trace; внутренний (утилита промпта) —
 * только операцию. Пустые поля внутреннего контекста не затирают внешние.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { AiEntityType, AiOperationKey, AiTrigger } from '../../../../shared/aiUsage/catalog'

export interface AiUsageContext {
  organizationId?: string | null
  userId?: string | null
  operation?: AiOperationKey | null
  jobId?: string | null
  entity?: { type: AiEntityType; id: string } | null
  trigger?: AiTrigger | null
  /** Маршрут API или имя очереди. */
  source?: string | null
  /** Назначение конфигурации, по которому её выбрали (analysis/structuring/…). */
  purpose?: string | null
  traceId?: string | null
  /**
   * Сборщик id событий этого контекста (не наследуется вниз «как есть» — у каждого
   * withAiOperation свой, если задан). Нужен, чтобы пометить события постфактум
   * (structured output восстановлен / не прошёл схему).
   */
  eventCollector?: string[] | null
}

export interface AiUsageStore extends AiUsageContext {
  traceId: string
  /** Счётчик шагов внутри трейса (общий объект для вложенных контекстов). */
  stepCounter: { n: number }
}

const storage = new AsyncLocalStorage<AiUsageStore>()

function merge(parent: AiUsageStore | undefined, ctx: AiUsageContext): AiUsageStore {
  const pick = <K extends keyof AiUsageContext>(k: K) => (ctx[k] ?? parent?.[k] ?? null) as AiUsageStore[K]
  const sameTrace = !ctx.traceId || ctx.traceId === parent?.traceId
  return {
    organizationId: pick('organizationId'),
    userId: pick('userId'),
    operation: pick('operation'),
    jobId: pick('jobId'),
    entity: pick('entity'),
    trigger: pick('trigger'),
    source: pick('source'),
    purpose: pick('purpose'),
    eventCollector: pick('eventCollector'),
    traceId: ctx.traceId ?? parent?.traceId ?? randomUUID(),
    stepCounter: sameTrace && parent ? parent.stepCounter : { n: 0 },
  }
}

/** Выполнить fn в контексте ИИ-операции (наследуя родительский контекст). */
export function withAiOperation<T>(ctx: AiUsageContext, fn: () => T): T {
  return storage.run(merge(storage.getStore(), ctx), fn)
}

/** Новый трейс (новое действие пользователя) поверх текущего контекста. */
export function withAiTrace<T>(ctx: AiUsageContext, fn: () => T): T {
  return storage.run(merge(storage.getStore(), { ...ctx, traceId: ctx.traceId ?? randomUUID() }), fn)
}

export function getAiUsageContext(): AiUsageStore | undefined {
  return storage.getStore()
}

/** Следующий номер шага в текущем трейсе (1, 2, …). */
export function nextAiStep(store: AiUsageStore | undefined): number {
  if (!store) return 1
  store.stepCounter.n += 1
  return store.stepCounter.n
}

/**
 * Контекст HTTP-запроса (организация и пользователь из requirePermission).
 * Резолвер регистрирует nitro-плагин (server/plugins/ai-usage.ts) через useEvent();
 * в unit-тестах резолвера нет — используется только явный контекст.
 */
export interface AiRequestActor {
  organizationId?: string | null
  userId?: string | null
  source?: string | null
  trigger?: AiTrigger | null
}

let requestResolver: (() => AiRequestActor | null) | null = null

export function setAiRequestResolver(fn: (() => AiRequestActor | null) | null): void {
  requestResolver = fn
}

export function resolveAiRequestActor(): AiRequestActor | null {
  if (!requestResolver) return null
  try {
    return requestResolver()
  }
  catch {
    return null
  }
}

/** Ключ в event.context, куда requirePermission/requireAuth кладут актора. */
export const AI_ACTOR_CONTEXT_KEY = 'aiUsageActor'

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{16,}|\d+)$/

/** /api/applications/<uuid>/analyze → /api/applications/:id/analyze (для группировки по источнику). */
export function normalizeAiRoute(path: string): string {
  const clean = path.split('?')[0] ?? ''
  return clean.split('/').map(seg => (seg && ID_SEGMENT.test(seg) ? ':id' : seg)).join('/')
}
