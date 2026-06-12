import { z } from 'zod'

/**
 * Validation schemas for the collaboration thread (application_comment, watchers).
 */

export const createApplicationCommentSchema = z.object({
  body: z.string().min(1).max(10_000),
  isInternal: z.boolean().optional().default(false),
  parentCommentId: z.string().min(1).optional(),
})

export const updateApplicationCommentSchema = z.object({
  body: z.string().min(1).max(10_000),
})

export const applicationCommentQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export const applicationCommentIdParamSchema = z.object({
  id: z.string().min(1),
  commentId: z.string().min(1),
})

export const watcherAddSchema = z.object({
  userId: z.string().min(1),
})

export const watcherIdParamSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
})

export const orgMemberSearchSchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
