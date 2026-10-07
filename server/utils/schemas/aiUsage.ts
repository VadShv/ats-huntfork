/**
 * Схемы API «Расход ИИ» — бюджеты и пересчёт (docs/tz-ai-usage.md §7, §10).
 */
import { z } from 'zod'
import { AI_FEATURES, AI_OPERATIONS } from '../../../shared/aiUsage/catalog'

const thresholdsSchema = z.array(z.number().int().min(1).max(200)).min(1).max(6)
  .transform(a => [...new Set(a)].sort((x, y) => x - y))

const budgetBase = z.object({
  scope: z.enum(['org', 'feature', 'operation', 'user', 'member_default']),
  scopeKey: z.string().trim().max(200).nullable().optional(),
  period: z.enum(['month', 'day']).default('month'),
  limitAmount: z.number().positive().max(1_000_000_000),
  currency: z.enum(['RUB', 'USD']).optional(),
  thresholds: thresholdsSchema.default([50, 80, 100]),
  onExceed: z.enum(['notify', 'block_background', 'block_all']).default('notify'),
  isActive: z.boolean().default(true),
})

function checkScopeKey(v: { scope?: string; scopeKey?: string | null; onExceed?: string }, ctx: z.RefinementCtx) {
  // block_all — только для персональных лимитов: оргбюджет не должен останавливать ручную работу.
  if (v.onExceed === 'block_all' && v.scope && v.scope !== 'user' && v.scope !== 'member_default') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['onExceed'], message: 'Полная блокировка доступна только для лимитов участников' })
  }
  if (!v.scope || v.scope === 'org' || v.scope === 'member_default') return
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

/** Лимиты участников (docs/design-profile-and-token-limits.md §3.3). */
const limitAmount = z.number().positive().max(1_000_000_000).nullable()

export const memberLimitSchema = z.object({
  /** null — лимит на этот период снять (для участника — вернуться к умолчанию). */
  dayLimit: limitAmount.optional(),
  monthLimit: limitAmount.optional(),
  onExceed: z.enum(['notify', 'block_all']).default('block_all'),
})

export const limitIncreaseRequestSchema = z.object({
  period: z.enum(['day', 'month']),
  comment: z.string().trim().max(300).optional(),
})
