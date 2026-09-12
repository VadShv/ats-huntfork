/**
 * Server-side gate for the AI assistant (chatbot).
 *
 * RBAC v2 §5: the assistant is an AI feature — access requires an AI permission
 * (`scoring:read`), not merely being logged in. Roles WITHOUT AI (e.g.
 * external_recruiter) therefore cannot reach the assistant, which also closes
 * the old "requireAuth-only" gap. The single swap point for assistant gating.
 *
 * `scoring` is the established AI-capability convention (used by the AI-config
 * UI). owner/admin/recruiter(member)/lead_recruiter have scoring:read;
 * external_recruiter does not.
 */
import type { H3Event } from 'h3'

export async function requireChatbotAccess(event: H3Event) {
  // AI permission + the reads the assistant performs (jobs/candidates/apps/docs).
  return requirePermission(event, {
    scoring: ['read'],
    job: ['read'],
    candidate: ['read'],
    application: ['read'],
    document: ['read'],
  })
}
