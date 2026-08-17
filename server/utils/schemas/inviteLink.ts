import { z } from 'zod'

/**
 * Schema for creating a new shareable invite link.
 */
/**
 * Роли, которые можно выдавать через invite-link.
 * `hiring_manager` добавлен в Sprint 20.5 — владелец/админ организации
 * генерит ссылку в Настройках → Участники, нанимающий сам проходит
 * self-signup и привязывается к орг с ролью hiring_manager.
 */
export const createInviteLinkSchema = z.object({
  role: z.enum(['admin', 'member', 'hiring_manager']).default('member'),
  maxUses: z.number().int().min(1).max(10000).nullable().optional().default(null),
  /** Expiry duration in hours — minimum 1h, maximum 30 days, default 7 days */
  expiresInHours: z.number().int().min(1).max(720).default(168),
})

/**
 * Schema for accepting an invite link by token.
 */
export const acceptInviteLinkSchema = z.object({
  token: z.string().min(1).max(128),
})
