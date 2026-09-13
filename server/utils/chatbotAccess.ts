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
  // §I: base gate for the assistant is `assistant:access` (decoupled from
  // scoring — candidate scoring stays with recruiters). Roles without
  // assistant:access (member/hrbp/external/hm by default) → 403 on every
  // chatbot/* endpoint. The reads the assistant performs are still required.
  return requirePermission(event, {
    assistant: ['access'],
    job: ['read'],
    candidate: ['read'],
    application: ['read'],
    document: ['read'],
  })
}
