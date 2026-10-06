/**
 * Схемы API «Расход ИИ» — бюджеты и пересчёт (docs/tz-ai-usage.md §7, §10).
 */
import { z } from 'zod'
import { AI_FEATURES, AI_OPERATIONS } from '../../../shared/aiUsage/catalog'

const thresholdsSchema = z.array(z.number().int().min(1).max(200)).min(1).max(6)
  .transform(a => [...new Set(a)].sort((x, y) => x - y))

const budgetBase = z.object({
  scope: z.enum(['org', 'feature', 'operation', 'user']),
  scopeKey: z.string().trim().max(200).nullable().optional(),
  period: z.enum(['month', 'day']).default('month'),
  limitAmount: z.number().positive().max(1_000_000_000),
  currency: z.enum(['RUB', 'USD']).optional(),
  thresholds: thresholdsSchema.default([50, 80, 100]),
  onExceed: z.enum(['notify', 'block_background']).default('notify'),
  isActive: z.boolean().default(true),
})

function checkScopeKey(v: { scope?: string; scopeKey?: string | null }, ctx: z.RefinementCtx) {
  if (!v.scope || v.scope === 'org') return
  if (!v.scopeKey) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scopeKey'], message: 'Укажите, на что действует бюджет' })
    return
  }
  if (v.scope === 'feature' && !(AI_FEATURES as readonly string[]).includes(v.scopeKey)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scopeKey'], message: 'Неизвестная фича' })
  }
  if (v.scope === 'operation' && !AI_OPERATIONS.some(o => o.key === v.scopeKey)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scopeKey'], message: 'Неизвестная операция' })
  }
}

export const createBudgetSchema = budgetBase.superRefine(checkScopeKey)

export const updateBudgetSchema = budgetBase.partial().superRefine(checkScopeKey)

export const recalculateSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  aiConfigId: z.string().min(1).max(100).optional(),
})
