/**
 * GET /api/ai-usage/export.csv?kind=events|breakdown&by=… — CSV по текущим фильтрам
 * (docs/tz-ai-usage.md §8.1 «Экспорт»). Требует aiUsage:export; суммы — при view_costs.
 */
import { z } from 'zod'
import { BREAKDOWN_DIMENSIONS, getBreakdown } from '../../utils/ai/usage/breakdown'
import { listEvents } from '../../utils/ai/usage/events'
import { csvEscape, requireAiUsageAccess, resolveUsageFilters, usageFilterSchema } from '../../utils/ai/usage/query'

const schema = usageFilterSchema.extend({
  kind: z.enum(['events', 'breakdown']).default('events'),
  by: z.enum(BREAKDOWN_DIMENSIONS).default('operation'),
})

const MAX_EVENTS = 50_000

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event, 'export')
  const q = await getValidatedQuery(event, schema.parse)
  const f = resolveUsageFilters(q, access)
  const money = access.canViewCosts
  const cur = access.currency.baseCurrency

  let header: string[]
  const lines: string[] = []
  if (q.kind === 'breakdown') {
    const { rows } = await getBreakdown(access.orgId, f, q.by, 500)
    header = ['Ключ', 'Название', 'Вызовов', 'Действий', 'Токены вход', 'Токены выход', 'Размышления', 'Ошибки', 'Ср. время, мс']
    if (money) header.push(`Расход, ${cur}`, 'Доля', `Ср. за действие, ${cur}`)
    for (const r of rows) {
      const cells: unknown[] = [r.key, r.label, r.calls, r.traces, r.inputTokens, r.outputTokens, r.reasoningTokens, r.errors, r.avgDurationMs]
      if (money) cells.push(r.cost.toFixed(4), Number(r.share ?? 0).toFixed(4), Number(r.avgCostPerTrace ?? 0).toFixed(4))
      lines.push(cells.map(csvEscape).join(';'))
    }
  }
  else {
    header = ['Время', 'Трейс', 'Шаг', 'Операция', 'Фича', 'Триггер', 'Пользователь', 'Вакансия', 'Сущность', 'ID сущности',
      'Провайдер', 'Модель', 'Конфигурация', 'Токены вход', 'Из них кэш', 'Токены выход', 'Размышления', 'Оценка токенов',
      'Длительность, мс', 'Статус', 'Код ошибки', 'Причина остановки']
    if (money) header.push('Валюта цены', 'Стоимость в валюте цены', `Стоимость, ${cur}`)
    let cursor: string | undefined
    let total = 0
    do {
      const page = await listEvents(access.orgId, f, { cursor, limit: 1000 })
      for (const r of page.items) {
        const cells: unknown[] = [r.createdAt, r.traceId, r.stepNo, r.label, r.featureLabel, r.trigger, r.userName ?? '', r.jobTitle ?? '',
          r.entityType ?? '', r.entityId ?? '', r.provider, r.model, r.aiConfigName ?? '', r.inputTokens, r.cachedInputTokens,
          r.outputTokens, r.reasoningTokens, r.tokensEstimated ? 'да' : '', r.durationMs ?? '', r.status, r.errorCode ?? '', r.finishReason ?? '']
        if (money) cells.push(r.priceCurrency, r.costInConfigCurrency ?? '', r.cost ?? '')
        lines.push(cells.map(csvEscape).join(';'))
      }
      total += page.items.length
      cursor = page.nextCursor ?? undefined
    } while (cursor && total < MAX_EVENTS)
  }

  const stamp = new Date().toISOString().slice(0, 10)
  setResponseHeaders(event, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="ai-usage-${q.kind}-${stamp}.csv"`,
  })
  // BOM — чтобы Excel открыл кириллицу без «кракозябр».
  return `\uFEFF${header.map(csvEscape).join(';')}\n${lines.join('\n')}\n`
})
