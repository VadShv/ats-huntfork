import { z } from 'zod'

/**
 * Схемы валидации для роли «Нанимающий менеджер» (Sprint 20.2).
 * См. docs/tz-hiring-manager-role-v1.md
 */

// ── Создание учётки НМ ────────────────────────────────────────
export const createHiringManagerSchema = z.object({
  name: z.string().trim().min(1, 'ФИО обязательно').max(200),
  email: z.string().trim().toLowerCase().email('Некорректный email').max(200),
  /** Если true — НМ видит зарплатные ожидания кандидатов. */
  canViewSalary: z.boolean().default(false),
  /** Опциональный внутренний комментарий (не отдаётся пользователю НМ). */
  internalNote: z.string().max(1000).optional(),
})

export type CreateHiringManagerInput = z.infer<typeof createHiringManagerSchema>

// ── Назначение НМ на вакансию ─────────────────────────────────
export const jobIdParamSchema = z.object({
  id: z.string().min(1).max(64),
})

export const addJobMemberSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  /** Поддерживаются 'hiring_manager' и 'recruiter'. Задел на watcher/assignee в v2. */
  memberRole: z.enum(['hiring_manager', 'recruiter', 'watcher', 'assignee']).default('hiring_manager'),
})

export const removeJobMemberSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  memberRole: z.enum(['hiring_manager', 'watcher', 'assignee']).default('hiring_manager'),
})

// ── Решение НМ по кандидату ─────────────────────────
export const createHmDecisionSchema = z.object({
  applicationId: z.string().trim().min(1).max(64),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(1000).optional(),
})

export type CreateHmDecisionInput = z.infer<typeof createHmDecisionSchema>

export const cancelHmDecisionSchema = z.object({
  reason: z.string().max(500).optional(),
})

// ── Смена временного пароля НМ при первом входе ────────────
export const hmChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, 'Минимум 8 символов').max(128),
})
